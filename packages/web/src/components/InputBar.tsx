import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { ArrowUp, Loader2, Send } from "lucide-react"
import clsx from "clsx"
import { useSessionStore, EMPTY_MESSAGES } from "../stores/session-store"
import { useRepoStore } from "../stores/repo-store"
import { useDraftStore } from "../stores/draft-store"
import { classifyPart, isQuestionPending } from "../lib/message-parts"
import type { ModelInfo } from "../lib/api-client"
import { getSettings, listModels } from "../lib/api-client"
import { AttachButton, AttachmentStrip, useAttachments } from "./Attachments"
import { VoiceButton } from "./VoiceButton"
import { useSpeechToText } from "../hooks/use-speech-to-text"

const MAX_HEIGHT_PX = 200
const VOICE_TEXTAREA_MAX_HEIGHT_PX = 240
const TICK_INTERVAL_MS = 1000
const LONG_PRESS_MS = 400
const LONG_PRESS_MOVE_THRESHOLD = 10

// Per-bar amplitude multipliers so the 7 bars scale volumeLevel at slightly
// different intensities — otherwise every bar would move in perfect lockstep
// even as the mic level fluctuates. Values center around 1.0.
const BAR_MULTIPLIERS = [0.85, 1.25, 0.65, 1.4, 0.75, 1.15, 0.95] as const
const BAR_MIN_HEIGHT_PX = 4
const BAR_MAX_HEIGHT_PX = 24

function formatDuration(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60).toString().padStart(2, "0")
  const ss = Math.floor(totalSeconds % 60).toString().padStart(2, "0")
  return `${mm}:${ss}`
}

function Waveform({ volumeLevel }: { volumeLevel: number }) {
  const clampedVolume = Math.min(Math.max(volumeLevel, 0), 1)
  return (
    <div className="flex h-6 items-center gap-1" aria-hidden="true">
      {BAR_MULTIPLIERS.map((multiplier, i) => {
        const raw =
          BAR_MIN_HEIGHT_PX +
          clampedVolume * multiplier * (BAR_MAX_HEIGHT_PX - BAR_MIN_HEIGHT_PX)
        const height = Math.max(
          BAR_MIN_HEIGHT_PX,
          Math.min(BAR_MAX_HEIGHT_PX, raw),
        )
        return (
          <span
            key={i}
            className="w-1 rounded-full bg-red-400 transition-[height] duration-150 ease-out"
            style={{ height: `${height}px` }}
          />
        )
      })}
    </div>
  )
}

function useHasPendingQuestion(): boolean {
  return useSessionStore((state) => {
    const id = state.activeSessionId
    if (!id) return false
    const msgs = state.messages[id] ?? EMPTY_MESSAGES
    for (let i = msgs.length - 1; i >= 0; i--) {
      const parts = msgs[i].parts
      if (!parts) continue
      for (const part of parts) {
        if (classifyPart(part) === "tool" && isQuestionPending(part)) return true
      }
    }
    return false
  })
}

export function InputBar() {
  const [value, setValue] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [pinnedModels, setPinnedModels] = useState<ModelInfo[]>([])
  const [voiceEditText, setVoiceEditText] = useState("")
  const [voiceElapsed, setVoiceElapsed] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const voiceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const voiceStartTimeRef = useRef(0)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTouchRef = useRef(false)
  const longPressStartPosRef = useRef({ x: 0, y: 0 })
  const stt = useSpeechToText()

  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const activeRepoId = useRepoStore((state) => state.activeRepoId)
  const status = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? state.sessionStatuses[id] : undefined
  })
  const sendMessage = useSessionStore((state) => state.sendMessage)
  const setDraft = useDraftStore((s) => s.setDraft)
  const clearDraft = useDraftStore((s) => s.clearDraft)
  const hasPendingQuestion = useHasPendingQuestion()

  useEffect(() => {
    if (!activeRepoId) { setPinnedModels([]); return }
    let cancelled = false
    void (async () => {
      try {
        const [settings, models] = await Promise.all([
          getSettings(),
          listModels(activeRepoId),
        ])
        if (cancelled) return
        const raw = settings.pinned_models
        const pinnedIds: string[] = raw ? JSON.parse(raw) : []
        setPinnedModels(pinnedIds.length > 0 ? models.filter((m) => pinnedIds.includes(m.id)) : [])
      } catch {
        if (!cancelled) setPinnedModels([])
      }
    })()
    return () => { cancelled = true }
  }, [activeRepoId])

  const busy = status === "busy" && !hasPendingQuestion
  const disabled = !activeSessionId

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) {
      return
    }
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

  // Unknown model (default / unpinned) stays permissive; only a hard false blocks
  const imagesAllowed = pinnedModels.find((m) => m.id === selectedModel)?.supportsImage !== false
  const { attachments, promptFiles, error: attachError, addFiles, onPaste, remove, clear } = useAttachments(imagesAllowed)

  useEffect(() => {
    setValue(activeSessionId ? useDraftStore.getState().drafts[activeSessionId] ?? "" : "")
    clear()
    stt.stop()
  }, [activeSessionId, clear, stt.stop])

  // Recording elapsed timer (only ticks while recording).
  useEffect(() => {
    if (stt.phase === "recording") {
      voiceStartTimeRef.current = Date.now()
      setVoiceElapsed(0)
      voiceTimerRef.current = setInterval(() => {
        setVoiceElapsed(
          Math.floor((Date.now() - voiceStartTimeRef.current) / 1000),
        )
      }, TICK_INTERVAL_MS)
    } else {
      if (voiceTimerRef.current) {
        clearInterval(voiceTimerRef.current)
        voiceTimerRef.current = null
      }
    }
    return () => {
      if (voiceTimerRef.current) {
        clearInterval(voiceTimerRef.current)
        voiceTimerRef.current = null
      }
    }
  }, [stt.phase])

  // Seed editable buffer when phase transitions into "done" and focus it.
  useEffect(() => {
    if (stt.phase === "done") {
      setVoiceEditText(stt.transcript)
      requestAnimationFrame(() => {
        const el = voiceTextareaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })
    }
  }, [stt.phase, stt.transcript])

  // Auto-resize voice-edit textarea up to a max height.
  useLayoutEffect(() => {
    if (stt.phase !== "done") return
    const el = voiceTextareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, VOICE_TEXTAREA_MAX_HEIGHT_PX)}px`
  }, [stt.phase, voiceEditText])

  const submit = async () => {
    const text = value.trim()
    if (disabled || (!text && attachments.length === 0)) {
      return
    }
    const ok = await sendMessage(text, selectedModel || undefined, promptFiles.length > 0 ? promptFiles : undefined)
    if (ok) {
      setValue("")
      clear()
      if (activeSessionId) clearDraft(activeSessionId)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const canStartVoice = () => {
    if (disabled) return false
    if (stt.phase !== "idle") return false
    const textarea = textareaRef.current
    if (textarea && document.activeElement === textarea && value.trim().length > 0) return false
    return true
  }

  const handleContainerTouchStart = (e: React.TouchEvent) => {
    if (!canStartVoice()) return
    const touch = e.touches[0]
    longPressStartPosRef.current = { x: touch.clientX, y: touch.clientY }
    longPressTimerRef.current = setTimeout(() => {
      longPressTouchRef.current = true
      textareaRef.current?.blur()
      stt.start()
      const stop = () => {
        document.removeEventListener("touchend", stop)
        document.removeEventListener("touchcancel", stop)
        longPressTouchRef.current = false
        void stt.stop()
      }
      document.addEventListener("touchend", stop, { once: true })
      document.addEventListener("touchcancel", stop, { once: true })
    }, LONG_PRESS_MS)
  }

  const handleContainerTouchMove = (e: React.TouchEvent) => {
    if (!longPressTimerRef.current) return
    const touch = e.touches[0]
    const dx = touch.clientX - longPressStartPosRef.current.x
    const dy = touch.clientY - longPressStartPosRef.current.y
    if (Math.abs(dx) > LONG_PRESS_MOVE_THRESHOLD || Math.abs(dy) > LONG_PRESS_MOVE_THRESHOLD) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleContainerTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleContainerMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest("button") || target.closest("[role='button']")) return
    if (!canStartVoice()) return

    let fired = false
    longPressTimerRef.current = setTimeout(() => {
      fired = true
      textareaRef.current?.blur()
      stt.start()
    }, LONG_PRESS_MS)

    const handleUp = () => {
      document.removeEventListener("mouseup", handleUp)
      if (!fired) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current)
          longPressTimerRef.current = null
        }
      } else {
        void stt.stop()
      }
    }
    document.addEventListener("mouseup", handleUp, { once: true })
  }

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }
  }, [])

  const handleVoiceCancel = () => {
    void stt.stop()
    stt.resetTranscript()
    setVoiceEditText("")
  }

  const handleVoiceConfirm = async () => {
    const text = voiceEditText.trim()
    if (!text) { handleVoiceCancel(); return }
    const ok = await sendMessage(text, selectedModel || undefined)
    if (ok) {
      stt.resetTranscript()
      setVoiceEditText("")
    }
  }

  // Escape → cancel (except during "recognizing" — that's uninterruptable server work).
  // Cmd/Ctrl+Enter during "done" → confirm.
  useEffect(() => {
    if (stt.phase === "idle") return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && stt.phase !== "recognizing") {
        e.preventDefault()
        handleVoiceCancel()
        return
      }
      if (
        stt.phase === "done" &&
        e.key === "Enter" &&
        (e.metaKey || e.ctrlKey)
      ) {
        if ((e as unknown as { isComposing?: boolean }).isComposing) return
        e.preventDefault()
        void handleVoiceConfirm()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stt.phase, voiceEditText])

  const handleVoiceTextareaKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleVoiceConfirm()
    }
  }

  const placeholder = !activeSessionId
    ? "select or start a run"
    : hasPendingQuestion
      ? "输入回复，或点击上方选项…"
      : busy
        ? "输入消息将排队等待处理…"
        : "enter a command…"

  const promptColor = !activeSessionId
    ? "text-fg-6"
    : busy
      ? "text-amber-400 fs-blink"
      : hasPendingQuestion
        ? "text-blue-400"
        : "text-emerald-400"

  const combinedRecordingHasText =
    stt.transcript.length > 0 || stt.interimTranscript.length > 0

  return (
    <div className="relative border-t border-line bg-term px-4 py-4">
      {stt.phase !== "idle" && (
        <div className="absolute bottom-full left-0 right-0 z-20 border-t border-line bg-surface/95 backdrop-blur-sm">
          <div className="mx-auto max-h-[40vh] w-full max-w-4xl overflow-y-auto px-4 py-4">
            {stt.phase === "recording" && (
              <div className="text-xl leading-relaxed">
                {combinedRecordingHasText ? (
                  <>
                    <span className="text-fg">{stt.transcript}</span>
                    {stt.interimTranscript && (
                      <span className="text-fg-4">{stt.interimTranscript}</span>
                    )}
                  </>
                ) : (
                  <span className="italic text-fg-5">正在聆听…</span>
                )}
              </div>
            )}

            {stt.phase === "recognizing" && (
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 shrink-0 text-emerald-400 fs-spin" />
                <span className="font-mono text-sm text-emerald-400">
                  识别中…
                </span>
                {stt.interimTranscript && (
                  <span className="truncate text-base text-fg-4">
                    {stt.interimTranscript}
                  </span>
                )}
              </div>
            )}

            {stt.phase === "done" && (
              <textarea
                ref={voiceTextareaRef}
                value={voiceEditText}
                onChange={(e) => setVoiceEditText(e.target.value)}
                onKeyDown={handleVoiceTextareaKey}
                rows={2}
                placeholder="识别结果（可编辑）"
                className="w-full resize-none bg-transparent text-xl leading-relaxed text-fg placeholder:text-fg-5 focus:outline-none"
              />
            )}
          </div>
        </div>
      )}

      <AttachmentStrip
        attachments={attachments}
        error={attachError}
        onRemove={remove}
        className="mx-auto max-w-4xl"
      />
      <div
        className={clsx(
          "mx-auto flex max-w-4xl items-start gap-2 rounded-lg border px-3 py-2 transition-colors duration-150",
          disabled
            ? "border-line"
            : "border-fg-5 focus-within:border-fg-4",
        )}
        onTouchStart={handleContainerTouchStart}
        onTouchMove={handleContainerTouchMove}
        onTouchEnd={handleContainerTouchEnd}
        onTouchCancel={handleContainerTouchEnd}
        onMouseDown={handleContainerMouseDown}
        onContextMenu={(e) => { if (longPressTouchRef.current) e.preventDefault() }}
        style={{ WebkitTouchCallout: "none" }}
      >
        <span className={clsx("select-none pt-px font-mono text-sm leading-6", promptColor)}>
          ❯
        </span>
        <textarea
          ref={textareaRef}
          rows={2}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const v = event.target.value
            setValue(v)
            if (activeSessionId) setDraft(activeSessionId, v)
          }}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          className="flex-1 resize-none bg-transparent font-mono text-sm leading-6 text-fg placeholder:text-fg-6 focus:outline-none disabled:cursor-not-allowed"
        />
        <AttachButton
          onFiles={(files) => void addFiles(files)}
          disabled={disabled}
          allowed={imagesAllowed}
        />
        <VoiceButton isListening={stt.isListening} />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || (value.trim().length === 0 && attachments.length === 0)}
          aria-label="Send message"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white transition-colors duration-150 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6/30 disabled:text-fg-5"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>

      {stt.phase === "idle" ? (
        <div className="mx-auto mt-1.5 flex max-w-4xl items-center gap-3 pl-5">
          {stt.error && (
            <span className="font-mono text-[10px] text-red-400">{stt.error}</span>
          )}
          <span className="font-mono text-[10px] text-fg-6">⏎ to run · shift+⏎ for newline</span>
          {pinnedModels.length > 0 && (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="ml-auto max-w-[200px] truncate rounded border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-fg-4 focus:border-fg-5 focus:outline-none"
            >
              <option value="">默认模型</option>
              {pinnedModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name || m.id}</option>
              ))}
            </select>
          )}
        </div>
      ) : stt.phase === "done" ? (
        <div className="mx-auto mt-1.5 flex max-w-4xl items-center gap-2 pl-5">
          <span className="hidden font-mono text-[10px] text-fg-6 sm:inline">
            ⌘/Ctrl+⏎ 发送 · Esc 取消
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleVoiceCancel}
              className="rounded-md border border-line px-3 py-1 text-xs text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleVoiceConfirm()}
              disabled={voiceEditText.trim().length === 0}
              aria-label="发送"
              className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6/30 disabled:text-fg-5"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={2.5} />
              <span>发送</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="mx-auto mt-1.5 flex max-w-4xl items-center gap-3 pl-5">
          {stt.phase === "recording" ? (
            <>
              <Waveform volumeLevel={stt.volumeLevel} />
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-red-400">
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-400" />
                录音中
              </span>
              <span className="font-mono text-[11px] tabular-nums text-fg-4">
                {formatDuration(voiceElapsed)}
              </span>
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 shrink-0 text-emerald-400 fs-spin" />
              <span className="font-mono text-[11px] text-emerald-400">
                识别中…
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

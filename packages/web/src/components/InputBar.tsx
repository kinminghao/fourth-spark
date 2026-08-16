import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { ArrowUp } from "lucide-react"
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const stt = useSpeechToText()
  const preVoiceValueRef = useRef("")

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

  const handleVoiceToggle = () => {
    if (stt.isListening) {
      stt.stop()
    } else {
      preVoiceValueRef.current = value
      stt.start()
    }
  }

  // Sync voice transcript → textarea while recording
  useEffect(() => {
    if (stt.isListening) {
      setValue(preVoiceValueRef.current + stt.transcript + stt.interimTranscript)
    }
  }, [stt.isListening, stt.transcript, stt.interimTranscript])

  // Commit transcript when recording ends (handles async server engine)
  const wasListeningRef = useRef(false)
  useEffect(() => {
    if (wasListeningRef.current && !stt.isListening && stt.transcript) {
      const committed = preVoiceValueRef.current + stt.transcript
      setValue(committed)
      if (activeSessionId) setDraft(activeSessionId, committed)
    }
    wasListeningRef.current = stt.isListening
  }, [stt.isListening, stt.transcript, activeSessionId, setDraft])

  const placeholder = !activeSessionId
    ? "select or start a run"
    : hasPendingQuestion
      ? "输入回复，或点击上方选项…"
      : busy
        ? "输入消息将排队等待处理…"
        : "enter a command…"

  const promptColor = !activeSessionId
    ? "text-fg-6"
    : stt.isListening
      ? "text-red-400 fs-blink"
      : busy
        ? "text-amber-400 fs-blink"
        : hasPendingQuestion
          ? "text-blue-400"
          : "text-emerald-400"

  return (
    <div className="border-t border-line bg-term px-4 py-4">
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
            : stt.isListening
              ? "border-red-500/60"
              : "border-fg-5 focus-within:border-fg-4",
        )}
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
        <VoiceButton
          isListening={stt.isListening}
          disabled={disabled}
          onClick={handleVoiceToggle}
          error={stt.error}
        />
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
      <div className="mx-auto mt-1.5 flex max-w-4xl items-center gap-3 pl-5">
        {stt.isListening && (
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-red-400">● 录音中</span>
            <div className="h-1 w-16 overflow-hidden rounded-full bg-fg-6/30">
              <div
                className="h-full rounded-full bg-red-400 transition-[width] duration-75"
                style={{ width: `${Math.round(stt.volumeLevel * 100)}%` }}
              />
            </div>
          </div>
        )}
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
    </div>
  )
}

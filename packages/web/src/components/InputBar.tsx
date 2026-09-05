import {
  useCallback,
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
import { AttachButton, AttachmentStrip, shouldFoldText, useAttachments } from "./Attachments"
import { VoiceButton } from "./VoiceButton"
import { VoiceOverlay, VoiceStatusBar } from "./VoiceOverlay"
import { useVoiceInput } from "../hooks/use-voice-input"

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
  const [selectedVariant, setSelectedVariant] = useState("")
  const [pinnedModels, setPinnedModels] = useState<ModelInfo[]>([])
  const [quickInputs, setQuickInputs] = useState<Array<{ label: string; text: string; autoSend?: boolean }>>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  const handleVoiceSubmit = useCallback(
    async (text: string) => {
      const ok = await sendMessage(text, selectedModel || undefined, selectedVariant || undefined)
      if (!ok) return false
    },
    [sendMessage, selectedModel, selectedVariant],
  )

  const voice = useVoiceInput(handleVoiceSubmit)

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
        const filtered = pinnedIds.length > 0 ? models.filter((m) => pinnedIds.includes(m.id)) : models
        setPinnedModels(filtered.length > 0 ? filtered : models)
      } catch {
        if (!cancelled) setPinnedModels([])
      }
    })()
    return () => { cancelled = true }
  }, [activeRepoId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const s = await getSettings()
        if (cancelled) return
        const raw = s.quick_inputs
        if (raw) {
          try { setQuickInputs(JSON.parse(raw)) } catch { /* ignore bad JSON */ }
        } else {
          setQuickInputs([{ label: "继续", text: "继续", autoSend: true }])
        }
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [])

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
  const { attachments, foldedTexts, promptFiles, error: attachError, addFiles, onPaste: imageOnPaste, addFoldedText, expandFoldedTexts, remove, removeFoldedText, clear } = useAttachments(imagesAllowed)

  useEffect(() => {
    setValue(activeSessionId ? useDraftStore.getState().drafts[activeSessionId] ?? "" : "")
    clear()
    voice.stt.stop()
  }, [activeSessionId, clear, voice.stt.stop])

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length > 0) {
      imageOnPaste(event)
      return
    }

    const text = event.clipboardData.getData("text/plain")
    if (!text || !shouldFoldText(text)) return

    event.preventDefault()
    const fold = addFoldedText(text)

    const textarea = event.currentTarget
    const start = textarea.selectionStart ?? value.length
    const end = textarea.selectionEnd ?? value.length
    const newValue = value.slice(0, start) + fold.placeholder + value.slice(end)
    setValue(newValue)
    if (activeSessionId) setDraft(activeSessionId, newValue)

    requestAnimationFrame(() => {
      const pos = start + fold.placeholder.length
      textarea.setSelectionRange(pos, pos)
    })
  }

  const handleRemoveFoldedText = (id: string) => {
    const fold = foldedTexts.find((f) => f._id === id)
    if (fold) {
      const newValue = value.replace(fold.placeholder, "")
      setValue(newValue)
      if (activeSessionId) setDraft(activeSessionId, newValue)
    }
    removeFoldedText(id)
  }

  const submit = async () => {
    const content = expandFoldedTexts(value.trim())
    if (disabled || (!content && attachments.length === 0)) {
      return
    }
    const ok = await sendMessage(content, selectedModel || undefined, selectedVariant || undefined, promptFiles.length > 0 ? promptFiles : undefined)
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

  return (
    <div className="relative border-t border-line bg-term px-4 py-4">
      <VoiceOverlay
        phase={voice.stt.phase}
        transcript={voice.stt.transcript}
        interimTranscript={voice.stt.interimTranscript}
        editText={voice.editText}
        onEditTextChange={voice.setEditText}
        onTextareaKeyDown={voice.handleTextareaKeyDown}
        textareaRef={voice.textareaRef}
        wrapperClassName="absolute bottom-full left-0 right-0 z-20 border-t border-line bg-surface/95 backdrop-blur-sm"
      />

      <AttachmentStrip
        attachments={attachments}
        foldedTexts={foldedTexts}
        error={attachError}
        onRemove={remove}
        onRemoveFoldedText={handleRemoveFoldedText}
        className="mx-auto max-w-4xl"
      />
      {quickInputs.length > 0 && (
        <div className="mx-auto mb-2 flex max-w-4xl gap-1.5 overflow-x-auto scrollbar-none">
          {quickInputs.map((qi, i) => (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (qi.autoSend) {
                  void sendMessage(qi.text, selectedModel || undefined, selectedVariant || undefined)
                } else {
                  setValue(qi.text)
                  if (activeSessionId) setDraft(activeSessionId, qi.text)
                  textareaRef.current?.focus()
                }
              }}
              className="shrink-0 rounded-full border border-line bg-surface px-3 py-1 text-xs text-fg-3 transition-colors hover:bg-elevated hover:text-fg-2 disabled:opacity-40"
            >
              {qi.label}
            </button>
          ))}
        </div>
      )}
      <div
        className={clsx(
          "mx-auto flex max-w-4xl items-start gap-2 rounded-lg border px-3 py-2 transition-colors duration-150",
          disabled
            ? "border-line"
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
          onPaste={handlePaste}
          placeholder={placeholder}
          className="flex-1 resize-none bg-transparent font-mono text-sm leading-6 text-fg placeholder:text-fg-6 focus:outline-none disabled:cursor-not-allowed"
        />
        <AttachButton
          onFiles={(files) => void addFiles(files)}
          disabled={disabled}
          allowed={imagesAllowed}
        />
        <VoiceButton
          isListening={voice.stt.isListening}
          disabled={disabled}
          onStart={voice.stt.start}
          onStop={() => void voice.stt.stop()}
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || (value.trim().length === 0 && attachments.length === 0 && foldedTexts.length === 0)}
          aria-label="Send message"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white transition-colors duration-150 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6/30 disabled:text-fg-5"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>

      {voice.stt.phase === "idle" ? (
        <div className="mx-auto mt-1.5 flex max-w-4xl items-center gap-3 pl-5">
          {voice.stt.error && (
            <span className="font-mono text-[10px] text-red-400">{voice.stt.error}</span>
          )}
          <span className="font-mono text-[10px] text-fg-6">⏎ to run · shift+⏎ for newline</span>
          <div className="ml-auto flex min-w-0 shrink items-center gap-1.5">
            <select
              value={selectedVariant}
              onChange={(e) => setSelectedVariant(e.target.value)}
              className="w-16 min-w-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-fg-4 focus:border-fg-5 focus:outline-none"
            >
              <option value="">默认</option>
              <option value="max">max</option>
              <option value="high">high</option>
            </select>
            {pinnedModels.length > 0 && (
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-24 min-w-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-fg-4 focus:border-fg-5 focus:outline-none"
              >
                <option value="">默认模型</option>
                {pinnedModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.id}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      ) : (
        <VoiceStatusBar
          phase={voice.stt.phase}
          volumeLevel={voice.stt.volumeLevel}
          elapsed={voice.elapsed}
          editText={voice.editText}
          error={voice.stt.error}
          onCancel={voice.cancel}
          onConfirm={() => void voice.confirm()}
          className="mx-auto mt-1.5 flex max-w-4xl items-center gap-3 pl-5"
        />
      )}
    </div>
  )
}

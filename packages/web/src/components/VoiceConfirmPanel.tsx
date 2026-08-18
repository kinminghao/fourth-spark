import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import clsx from "clsx"
import { Check, Loader2, Mic, Square, X } from "lucide-react"

const CLOSE_ANIM_MS = 180
const TEXTAREA_MAX_HEIGHT_PX = 240

export interface VoiceConfirmPanelProps {
  phase: "recording" | "recognizing" | "done"
  transcript: string
  interimTranscript: string
  volumeLevel: number
  error: string | null
  onConfirm: (text: string) => void
  onCancel: () => void
  onStop: () => void
}

export function VoiceConfirmPanel({
  phase,
  transcript,
  interimTranscript,
  volumeLevel,
  error,
  onConfirm,
  onCancel,
  onStop,
}: VoiceConfirmPanelProps) {
  const [editableText, setEditableText] = useState("")
  const [entered, setEntered] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Enter animation trigger — mount at translated/faded state, then flip on next frame.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => {
      cancelAnimationFrame(raf)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  // When phase transitions to "done", seed editable buffer from the finalized transcript.
  useEffect(() => {
    if (phase === "done") {
      setEditableText(transcript)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })
    }
  }, [phase, transcript])

  // Auto-resize editable textarea to content up to a max.
  useLayoutEffect(() => {
    if (phase !== "done") return
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
  }, [phase, editableText])

  const closeThen = useCallback((fn: () => void) => {
    if (isClosing) return
    setIsClosing(true)
    closeTimerRef.current = setTimeout(fn, CLOSE_ANIM_MS)
  }, [isClosing])

  const handleCancel = useCallback(() => {
    closeThen(onCancel)
  }, [closeThen, onCancel])

  const handleConfirm = useCallback(() => {
    const text = editableText.trim()
    if (text.length === 0) {
      closeThen(onCancel)
      return
    }
    closeThen(() => onConfirm(text))
  }, [closeThen, editableText, onCancel, onConfirm])

  // Global Escape → cancel; only in recording/done (recognizing is uninterruptable server work).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (phase === "recognizing") return
      e.preventDefault()
      handleCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [phase, handleCancel])

  const handleTextareaKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleConfirm()
    }
  }

  const combinedRecordingHasText =
    transcript.length > 0 || interimTranscript.length > 0
  const dotScale = 1 + Math.min(Math.max(volumeLevel, 0), 1) * 0.7

  const visible = entered && !isClosing

  return (
    <div
      role="dialog"
      aria-label="语音输入"
      className={clsx(
        "mx-auto mb-2 max-w-4xl transition-all duration-200 ease-out",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-1 opacity-0",
      )}
    >
      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-lg shadow-black/20">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          {phase === "recording" && (
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)] transition-transform duration-100 ease-out"
                style={{ transform: `scale(${dotScale})` }}
              />
              <span className="font-mono text-xs font-medium text-red-400 fs-blink">
                录音中
              </span>
            </div>
          )}
          {phase === "recognizing" && (
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 text-emerald-400 fs-spin" />
              <span className="font-mono text-xs font-medium text-emerald-400">
                识别中…
              </span>
            </div>
          )}
          {phase === "done" && (
            <div className="flex items-center gap-2">
              <Mic className="h-3.5 w-3.5 text-fg-4" />
              <span className="font-mono text-xs text-fg-3">
                识别完成 · 可编辑
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={handleCancel}
            aria-label="关闭语音面板"
            className="flex h-6 w-6 items-center justify-center rounded text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4">
          {phase === "recording" && (
            <div className="min-h-[3rem] text-lg leading-relaxed text-fg">
              {combinedRecordingHasText ? (
                <>
                  <span>{transcript}</span>
                  {interimTranscript && (
                    <span className="text-fg-4">{interimTranscript}</span>
                  )}
                </>
              ) : (
                <span className="text-base italic text-fg-5">
                  请开始说话…
                </span>
              )}
            </div>
          )}

          {phase === "recognizing" && (
            <div className="flex min-h-[3rem] items-center justify-center gap-3 text-fg-4">
              <Loader2 className="h-5 w-5 text-emerald-400 fs-spin" />
              <span className="text-base">正在识别语音…</span>
            </div>
          )}

          {phase === "done" && (
            <textarea
              ref={textareaRef}
              value={editableText}
              onChange={(e) => setEditableText(e.target.value)}
              onKeyDown={handleTextareaKey}
              rows={2}
              placeholder="识别结果（可编辑）"
              className="w-full resize-none rounded-md border border-line bg-term px-3 py-2 text-lg leading-relaxed text-fg placeholder:text-fg-5 focus:border-fg-4 focus:outline-none"
            />
          )}

          {error && (
            <p
              role="alert"
              className="mt-2 rounded bg-red-500/10 px-2 py-1 font-mono text-xs text-red-400"
            >
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-line bg-term/40 px-4 py-2.5">
          <span className="hidden font-mono text-[10px] text-fg-6 sm:inline">
            {phase === "recording" && "按 Esc 取消"}
            {phase === "recognizing" && "识别中，请稍候…"}
            {phase === "done" && "⌘/Ctrl+⏎ 确认 · Esc 取消"}
          </span>

          <div className="ml-auto flex items-center gap-2">
            {phase === "recording" && (
              <button
                type="button"
                onClick={onStop}
                aria-label="停止录音"
                className="flex items-center gap-1.5 rounded-md bg-red-500/15 px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/25"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>停止</span>
              </button>
            )}

            {phase === "recognizing" && (
              <button
                type="button"
                disabled
                className="flex cursor-not-allowed items-center gap-1.5 rounded-md bg-fg-6/20 px-3 py-1.5 text-sm text-fg-5"
              >
                <Loader2 className="h-3.5 w-3.5 fs-spin" />
                <span>处理中</span>
              </button>
            )}

            {phase === "done" && (
              <>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-md border border-line px-3 py-1.5 text-sm text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={editableText.trim().length === 0}
                  aria-label="确认并追加到输入框"
                  className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6/30 disabled:text-fg-5"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  <span>确认</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

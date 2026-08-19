import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import clsx from "clsx"
import { Loader2, Send, X } from "lucide-react"

const CLOSE_ANIM_MS = 180
const TEXTAREA_MAX_HEIGHT_PX = 240
const TICK_INTERVAL_MS = 1000

// Per-bar amplitude multipliers so the 7 bars scale volumeLevel at slightly
// different intensities — otherwise every bar would move in perfect lockstep
// even as the mic level fluctuates. Values center around 1.0.
const BAR_MULTIPLIERS = [0.85, 1.25, 0.65, 1.4, 0.75, 1.15, 0.95] as const
const BAR_MIN_HEIGHT_PX_MOBILE = 8
const BAR_MAX_HEIGHT_PX_MOBILE = 72
const BAR_MIN_HEIGHT_PX_DESKTOP = 4
const BAR_MAX_HEIGHT_PX_DESKTOP = 28

function formatDuration(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60).toString().padStart(2, "0")
  const ss = Math.floor(totalSeconds % 60).toString().padStart(2, "0")
  return `${mm}:${ss}`
}

export interface VoicePanelProps {
  phase: "recording" | "recognizing" | "done"
  transcript: string
  interimTranscript: string
  volumeLevel: number
  error: string | null
  isMobile: boolean
  onConfirm: (text: string) => void
  onCancel: () => void
}

function Waveform({
  volumeLevel,
  isMobile,
}: {
  volumeLevel: number
  isMobile: boolean
}) {
  const clampedVolume = Math.min(Math.max(volumeLevel, 0), 1)
  const min = isMobile ? BAR_MIN_HEIGHT_PX_MOBILE : BAR_MIN_HEIGHT_PX_DESKTOP
  const max = isMobile ? BAR_MAX_HEIGHT_PX_MOBILE : BAR_MAX_HEIGHT_PX_DESKTOP
  return (
    <div
      className={clsx("flex items-center gap-2", isMobile ? "h-24" : "h-8")}
      aria-hidden="true"
    >
      {BAR_MULTIPLIERS.map((multiplier, i) => {
        const raw = min + clampedVolume * multiplier * (max - min)
        const height = Math.max(min, Math.min(max, raw))
        return (
          <span
            key={i}
            className={clsx(
              "rounded-full bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.5)] transition-[height] duration-150 ease-out",
              isMobile ? "w-2" : "w-1",
            )}
            style={{ height: `${height}px` }}
          />
        )
      })}
    </div>
  )
}

export function VoicePanel({
  phase,
  transcript,
  interimTranscript,
  volumeLevel,
  error,
  isMobile,
  onConfirm,
  onCancel,
}: VoicePanelProps) {
  const [editableText, setEditableText] = useState("")
  const [entered, setEntered] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(Date.now())

  // Enter animation — mount at faded/scaled state, flip on next frame.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => {
      cancelAnimationFrame(raf)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  // Recording elapsed timer (only ticks while recording).
  useEffect(() => {
    if (phase !== "recording") {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }
    startTimeRef.current = Date.now()
    setElapsedSeconds(0)
    intervalRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, TICK_INTERVAL_MS)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [phase])

  // Seed editable buffer when phase transitions into "done".
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

  // Auto-resize editable textarea up to a max height.
  useLayoutEffect(() => {
    if (phase !== "done") return
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
  }, [phase, editableText])

  const closeThen = useCallback(
    (fn: () => void) => {
      if (isClosing) return
      setIsClosing(true)
      closeTimerRef.current = setTimeout(fn, CLOSE_ANIM_MS)
    },
    [isClosing],
  )

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

  // Escape → cancel (except during "recognizing" — that's uninterruptable server work).
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

  const visible = entered && !isClosing
  const combinedRecordingHasText =
    transcript.length > 0 || interimTranscript.length > 0

  // ── Mobile: full-screen overlay ──────────────────────────────────
  if (isMobile) {
    return (
      <div
        role="dialog"
        aria-label="语音输入"
        className={clsx(
          "fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-black/70 px-6 backdrop-blur-md transition-all duration-200 ease-out",
          visible ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
        )}
      >
        {phase === "recording" && (
          <>
            <Waveform volumeLevel={volumeLevel} isMobile />
            <div className="font-mono text-4xl font-medium tabular-nums tracking-widest text-fg">
              {formatDuration(elapsedSeconds)}
            </div>
            <div className="min-h-[3rem] max-h-[40vh] w-full max-w-md overflow-y-auto text-center text-xl leading-relaxed text-fg">
              {combinedRecordingHasText ? (
                <>
                  <span>{transcript}</span>
                  {interimTranscript && (
                    <span className="text-fg-4">{interimTranscript}</span>
                  )}
                </>
              ) : (
                <span className="italic text-fg-5">正在聆听…</span>
              )}
            </div>
          </>
        )}

        {phase === "recognizing" && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-10 w-10 text-emerald-400 fs-spin" />
            <span className="font-mono text-base text-emerald-400">识别中…</span>
            {interimTranscript && (
              <span className="max-w-md text-center text-base text-fg-4">
                {interimTranscript}
              </span>
            )}
          </div>
        )}

        {phase === "done" && (
          <div className="flex w-full max-w-md flex-col gap-4">
            <textarea
              ref={textareaRef}
              value={editableText}
              onChange={(e) => setEditableText(e.target.value)}
              onKeyDown={handleTextareaKey}
              rows={3}
              placeholder="识别结果（可编辑）"
              className="w-full resize-none rounded-lg border border-line bg-surface px-4 py-3 text-xl leading-relaxed text-fg placeholder:text-fg-5 focus:border-fg-4 focus:outline-none"
            />
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-line bg-surface px-5 py-2.5 text-sm text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={editableText.trim().length === 0}
                aria-label="发送"
                className="flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6/30 disabled:text-fg-5"
              >
                <Send className="h-4 w-4" strokeWidth={2.5} />
                <span>发送</span>
              </button>
            </div>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="max-w-md rounded bg-red-500/15 px-3 py-2 text-center font-mono text-xs text-red-400"
          >
            {error}
          </p>
        )}

        {phase !== "done" && (
          <button
            type="button"
            onClick={handleCancel}
            className="absolute bottom-8 font-mono text-sm text-fg-4 underline-offset-4 transition-colors hover:text-fg-2 hover:underline"
          >
            取消
          </button>
        )}
      </div>
    )
  }

  // ── Desktop: inline panel above input bar ────────────────────────
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
      <div className="relative overflow-hidden rounded-lg border border-line bg-surface shadow-lg shadow-black/20">
        <button
          type="button"
          onClick={handleCancel}
          aria-label="关闭语音面板"
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {phase === "recording" && (
          <div className="flex flex-col gap-3 px-4 py-4 pr-10">
            <div className="flex items-center gap-3">
              <Waveform volumeLevel={volumeLevel} isMobile={false} />
              <span className="font-mono text-xs font-medium text-red-400 fs-blink">
                录音中
              </span>
              <span className="font-mono text-xs tabular-nums text-fg-4">
                {formatDuration(elapsedSeconds)}
              </span>
            </div>
            <div className="min-h-[2rem] text-lg leading-relaxed text-fg">
              {combinedRecordingHasText ? (
                <>
                  <span>{transcript}</span>
                  {interimTranscript && (
                    <span className="text-fg-4">{interimTranscript}</span>
                  )}
                </>
              ) : (
                <span className="text-base italic text-fg-5">正在聆听…</span>
              )}
            </div>
          </div>
        )}

        {phase === "recognizing" && (
          <div className="flex flex-col items-center gap-3 px-4 py-6 pr-10">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 text-emerald-400 fs-spin" />
              <span className="font-mono text-sm text-emerald-400">识别中…</span>
            </div>
            {interimTranscript && (
              <span className="text-base text-fg-4">{interimTranscript}</span>
            )}
          </div>
        )}

        {phase === "done" && (
          <div className="flex flex-col gap-3 px-4 py-4 pr-10">
            <textarea
              ref={textareaRef}
              value={editableText}
              onChange={(e) => setEditableText(e.target.value)}
              onKeyDown={handleTextareaKey}
              rows={2}
              placeholder="识别结果（可编辑）"
              className="w-full resize-none rounded-md border border-line bg-term px-3 py-2 text-lg leading-relaxed text-fg placeholder:text-fg-5 focus:border-fg-4 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="hidden font-mono text-[10px] text-fg-6 sm:inline">
                ⌘/Ctrl+⏎ 发送 · Esc 取消
              </span>
              <div className="ml-auto flex items-center gap-2">
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
                  aria-label="发送"
                  className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6/30 disabled:text-fg-5"
                >
                  <Send className="h-3.5 w-3.5" strokeWidth={2.5} />
                  <span>发送</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mx-4 mb-3 rounded bg-red-500/10 px-2 py-1 font-mono text-xs text-red-400"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

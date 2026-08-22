import { type KeyboardEvent, type RefObject } from "react"
import { Loader2, Send } from "lucide-react"
import type { SpeechPhase } from "../hooks/use-speech-to-text"

// Per-bar amplitude multipliers so the 7 bars scale volumeLevel at slightly
// different intensities — otherwise every bar would move in perfect lockstep
// even as the mic level fluctuates. Values center around 1.0.
const BAR_MULTIPLIERS = [0.85, 1.25, 0.65, 1.4, 0.75, 1.15, 0.95] as const
const BAR_MIN_HEIGHT_PX = 4
const BAR_MAX_HEIGHT_PX = 24

export function formatVoiceDuration(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60).toString().padStart(2, "0")
  const ss = Math.floor(totalSeconds % 60).toString().padStart(2, "0")
  return `${mm}:${ss}`
}

export function Waveform({ volumeLevel }: { volumeLevel: number }) {
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

/**
 * The floating panel that appears above the input area during voice recording.
 * Shows live transcript (recording), spinner (recognizing), or editable textarea (done).
 *
 * `wrapperClassName` controls the outer container styling — RunView uses a
 * rounded floating card, InputBar uses a full-width border-top strip.
 */
export function VoiceOverlay({
  phase,
  transcript,
  interimTranscript,
  editText,
  onEditTextChange,
  onTextareaKeyDown,
  textareaRef,
  wrapperClassName,
}: {
  phase: SpeechPhase
  transcript: string
  interimTranscript: string
  editText: string
  onEditTextChange: (text: string) => void
  onTextareaKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  wrapperClassName?: string
}) {
  if (phase === "idle") return null

  const hasText = transcript.length > 0 || interimTranscript.length > 0

  return (
    <div className={wrapperClassName}>
      <div className="max-h-[40vh] overflow-y-auto px-4 py-4">
        {phase === "recording" && (
          <div className="text-xl leading-relaxed">
            {hasText ? (
              <>
                <span className="text-fg">{transcript}</span>
                {interimTranscript && (
                  <span className="text-fg-4">{interimTranscript}</span>
                )}
              </>
            ) : (
              <span className="italic text-fg-5">正在聆听…</span>
            )}
          </div>
        )}

        {phase === "recognizing" && (
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 shrink-0 text-emerald-400 fs-spin" />
            <span className="font-mono text-sm text-emerald-400">
              识别中…
            </span>
            {interimTranscript && (
              <span className="truncate text-base text-fg-4">
                {interimTranscript}
              </span>
            )}
          </div>
        )}

        {phase === "done" && (
          <textarea
            ref={textareaRef}
            value={editText}
            onChange={(e) => onEditTextChange(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            rows={2}
            placeholder="识别结果（可编辑）"
            className="w-full resize-none bg-transparent text-xl leading-relaxed text-fg placeholder:text-fg-5 focus:outline-none"
          />
        )}
      </div>
    </div>
  )
}

/**
 * Footer status bar shown below the input area during voice recording.
 * Shows waveform + timer (recording), spinner (recognizing), or confirm/cancel buttons (done).
 */
export function VoiceStatusBar({
  phase,
  volumeLevel,
  elapsed,
  editText,
  error,
  onCancel,
  onConfirm,
  idleHint,
  className,
}: {
  phase: SpeechPhase
  volumeLevel: number
  elapsed: number
  editText: string
  error: string | null
  onCancel: () => void
  onConfirm: () => void
  idleHint?: string
  className?: string
}) {
  if (phase === "idle") {
    return (
      <div className={className}>
        {error ? (
          <span className="font-mono text-[10px] text-red-400">{error}</span>
        ) : idleHint ? (
          <span className="font-mono text-[10px] text-fg-6">{idleHint}</span>
        ) : null}
      </div>
    )
  }

  if (phase === "done") {
    return (
      <div className={className}>
        <span className="hidden font-mono text-[10px] text-fg-6 sm:inline">
          ⌘/Ctrl+⏎ 发送 · Esc 取消
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line px-3 py-1 text-xs text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={editText.trim().length === 0}
            aria-label="发送"
            className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6/30 disabled:text-fg-5"
          >
            <Send className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span>发送</span>
          </button>
        </div>
      </div>
    )
  }

  // recording or recognizing
  return (
    <div className={className}>
      {phase === "recording" ? (
        <>
          <Waveform volumeLevel={volumeLevel} />
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-red-400">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-400" />
            录音中
          </span>
          <span className="font-mono text-[11px] tabular-nums text-fg-4">
            {formatVoiceDuration(elapsed)}
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
  )
}

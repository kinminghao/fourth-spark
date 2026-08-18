import { useEffect, useRef, useState } from "react"
import { Square } from "lucide-react"
import clsx from "clsx"

export interface VoiceRecordingOverlayProps {
  volumeLevel: number
  onStop: () => void
  onCancel: () => void
}

// Per-bar amplitude multipliers so the 7 bars scale volumeLevel at slightly
// different intensities — otherwise every bar would move in perfect lockstep
// even as the mic level fluctuates. Values center around 1.0.
const BAR_MULTIPLIERS = [0.85, 1.25, 0.65, 1.4, 0.75, 1.15, 0.95] as const
const BAR_MIN_HEIGHT_PX = 8
const BAR_MAX_HEIGHT_PX = 72
const TICK_INTERVAL_MS = 1000

function formatDuration(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60).toString().padStart(2, "0")
  const ss = Math.floor(totalSeconds % 60).toString().padStart(2, "0")
  return `${mm}:${ss}`
}

export function VoiceRecordingOverlay({
  volumeLevel,
  onStop,
  onCancel,
}: VoiceRecordingOverlayProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [entered, setEntered] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(Date.now())

  // Timer: setInterval id lives in a ref so the interval survives re-renders
  // without being recreated. Only `elapsedSeconds` state drives re-renders.
  useEffect(() => {
    startTimeRef.current = Date.now()
    intervalRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, TICK_INTERVAL_MS)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [])

  // Enter animation: mount at scale-95/opacity-0, then flip on the next frame.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const clampedVolume = Math.min(Math.max(volumeLevel, 0), 1)

  return (
    <div
      role="dialog"
      aria-label="正在录音"
      className={clsx(
        "fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-black/60 backdrop-blur-md transition-all duration-200 ease-out",
        entered ? "scale-100 opacity-100" : "scale-95 opacity-0",
      )}
    >
      {/* Waveform */}
      <div className="flex h-24 items-center gap-2" aria-hidden="true">
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
              className="w-2 rounded-full bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.5)] transition-[height] duration-150 ease-out"
              style={{ height: `${height}px` }}
            />
          )
        })}
      </div>

      {/* Timer */}
      <div className="font-mono text-5xl font-medium tabular-nums tracking-widest text-fg">
        {formatDuration(elapsedSeconds)}
      </div>

      {/* Stop button */}
      <button
        type="button"
        onClick={onStop}
        aria-label="停止录音"
        className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/40 transition-transform duration-150 hover:bg-red-400 active:scale-95"
      >
        <Square className="h-8 w-8 fill-white text-white" strokeWidth={0} />
      </button>

      {/* Cancel affordances: hint text + explicit cancel button */}
      <div className="flex flex-col items-center gap-3">
        <p className="font-mono text-xs text-fg-4">点击停止录音</p>
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-xs text-fg-5 underline-offset-2 transition-colors hover:text-fg-3 hover:underline"
        >
          取消录音
        </button>
      </div>
    </div>
  )
}

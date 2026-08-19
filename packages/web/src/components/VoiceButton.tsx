import { useRef } from "react"
import { Mic } from "lucide-react"
import clsx from "clsx"

export function VoiceButton({
  isListening,
  disabled,
  onStart,
  onStop,
  error,
}: {
  isListening: boolean
  disabled?: boolean
  onStart: () => void
  onStop: () => void
  error?: string | null
}) {
  // Track whether a touch gesture is active so the paired mouse events fired
  // by the browser after a touch don't double-fire start/stop.
  const touchActiveRef = useRef(false)

  const handleTouchStart = (e: React.TouchEvent<HTMLButtonElement>) => {
    if (disabled) return
    // Block the iOS long-press menu / text-selection callout without
    // preventing subsequent click synthesis on the same target.
    e.preventDefault()
    touchActiveRef.current = true
    onStart()
    // Global listener guarantees stop fires even if the button shifts,
    // is covered by the recording overlay, or the finger moves off it.
    const stop = () => {
      document.removeEventListener("touchend", stop)
      document.removeEventListener("touchcancel", stop)
      touchActiveRef.current = false
      onStop()
    }
    document.addEventListener("touchend", stop, { once: true })
    document.addEventListener("touchcancel", stop, { once: true })
  }

  const handleMouseDown = () => {
    if (disabled || touchActiveRef.current) return
    onStart()
    const stop = () => {
      document.removeEventListener("mouseup", stop)
      onStop()
    }
    document.addEventListener("mouseup", stop, { once: true })
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onTouchStart={handleTouchStart}
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="按住说话"
      title={error ?? "按住说话"}
      style={{ WebkitTouchCallout: "none" }}
      className={clsx(
        "flex h-7 w-7 shrink-0 select-none touch-none items-center justify-center rounded-md transition-colors duration-150 disabled:cursor-not-allowed disabled:text-fg-6/40",
        isListening
          ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
          : "text-fg-5 hover:text-fg-3",
      )}
    >
      <Mic className={clsx("h-4 w-4", isListening && "animate-pulse")} />
    </button>
  )
}

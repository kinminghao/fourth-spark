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
  }

  const handleTouchEnd = () => {
    if (!touchActiveRef.current) return
    touchActiveRef.current = false
    onStop()
  }

  const handleTouchCancel = () => {
    if (!touchActiveRef.current) return
    touchActiveRef.current = false
    onStop()
  }

  const handleMouseDown = () => {
    if (disabled) return
    if (touchActiveRef.current) return
    onStart()
  }

  const handleMouseUp = () => {
    if (touchActiveRef.current) return
    onStop()
  }

  const handleMouseLeave = () => {
    if (touchActiveRef.current) return
    if (isListening) onStop()
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="按住说话"
      title={error ?? "按住说话"}
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

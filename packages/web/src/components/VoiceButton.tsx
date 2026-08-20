import { useRef } from "react"
import { Mic } from "lucide-react"
import clsx from "clsx"

export function VoiceButton({
  isListening,
  disabled,
  onStart,
  onStop,
}: {
  isListening: boolean
  disabled?: boolean
  onStart: () => void
  onStop: () => void
}) {
  const touchActiveRef = useRef(false)

  const handleTouchStart = (e: React.TouchEvent<HTMLButtonElement>) => {
    if (disabled) return
    e.preventDefault()
    touchActiveRef.current = true
    onStart()
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
      title="按住说话"
      style={{ WebkitTouchCallout: "none" }}
      className={clsx(
        "flex shrink-0 select-none touch-none items-center justify-center transition-colors duration-150 disabled:cursor-not-allowed disabled:text-fg-6/40",
        "order-first self-stretch w-12 rounded-xl sm:order-none sm:self-auto sm:h-7 sm:w-7 sm:rounded-md",
        isListening
          ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
          : "text-fg-5 hover:text-fg-3",
      )}
    >
      <Mic className={clsx("h-6 w-6 sm:h-4 sm:w-4", isListening && "animate-pulse")} />
    </button>
  )
}

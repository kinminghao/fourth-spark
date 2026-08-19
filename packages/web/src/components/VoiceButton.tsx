import { Mic } from "lucide-react"
import clsx from "clsx"

export function VoiceButton({
  isListening,
}: {
  isListening: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
        isListening ? "text-red-400" : "text-fg-6",
      )}
    >
      <Mic className={clsx("h-4 w-4", isListening && "animate-pulse")} />
    </span>
  )
}

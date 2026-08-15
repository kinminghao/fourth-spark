import { Mic } from "lucide-react"
import clsx from "clsx"

export function VoiceButton({
  isListening,
  disabled,
  onClick,
  error,
}: {
  isListening: boolean
  disabled?: boolean
  onClick: () => void
  error?: string | null
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={isListening ? "停止语音输入" : "语音输入"}
      title={error ?? (isListening ? "点击停止" : "语音输入")}
      className={clsx(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150 disabled:cursor-not-allowed disabled:text-fg-6/40",
        isListening
          ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
          : "text-fg-5 hover:text-fg-3",
      )}
    >
      <Mic className={clsx("h-4 w-4", isListening && "animate-pulse")} />
    </button>
  )
}

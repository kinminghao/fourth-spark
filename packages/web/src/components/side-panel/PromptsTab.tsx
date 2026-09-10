import type { Message } from "../../lib/api-client"
import { formatTime, getTextPreview } from "./side-panel-utils"

export function PromptsTab({
  messages,
  onScrollToMessage,
}: {
  messages: readonly Message[]
  onScrollToMessage?: (messageId: string) => void
}) {
  const userMessages = messages.filter((m) => m.role === "user")

  if (userMessages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="font-mono text-xs text-fg-5">暂无输入记录</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      <ul className="space-y-1">
        {userMessages.map((msg, index) => {
          const preview = getTextPreview(msg)
          const time = formatTime(msg)
          return (
            <li key={msg.id}>
              <button
                type="button"
                onClick={() => onScrollToMessage?.(msg.id)}
                className="group w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-elevated/60"
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-[10px] text-emerald-400/60">
                    ❯
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-fg-5">
                    #{index + 1}
                  </span>
                  {time && (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-6">{time}</span>
                  )}
                </div>
                {preview && (
                  <p className="mt-0.5 line-clamp-2 pl-5 text-xs leading-relaxed text-fg-3 group-hover:text-fg-2">
                    {preview}
                  </p>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

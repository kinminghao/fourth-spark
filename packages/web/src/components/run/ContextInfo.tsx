import type { Message as ApiMessage, Session } from "../../lib/api-client"
import { formatTokens, formatCost } from "../../lib/format"
import { getLastAssistantTokens, getContextLimit } from "./run-view-utils"

export function ContextInfo({ session, messages }: { session: Session | null; messages: readonly ApiMessage[] }) {
  const lastTokens = getLastAssistantTokens(messages)
  const cost = session?.cost ?? 0
  if (!lastTokens && !cost) return null

  const contextLength = lastTokens
    ? lastTokens.input + (lastTokens.cache?.read ?? 0) + (lastTokens.cache?.write ?? 0)
    : 0
  const contextLimit = getContextLimit(session?.model?.modelID)
  const percentage = contextLength > 0 ? Math.min(Math.round((contextLength / contextLimit) * 100), 999) : 0

  const percentColor =
    percentage >= 80
      ? "text-red-400"
      : percentage >= 50
        ? "text-amber-400"
        : "text-fg-5"

  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-fg-5">
      {contextLength > 0 && (
        <>
          <span title={`当前上下文 = cache_read + cache_write + input (最近一次请求)`}>
            {formatTokens(contextLength)}
          </span>
          <span className="text-fg-6">·</span>
          <span className={percentColor} title={`上下文占比 (${formatTokens(contextLimit)} 窗口)`}>
            {percentage}%
          </span>
          <span className="text-fg-6">·</span>
        </>
      )}
      <span title="会话累计费用">{formatCost(cost)}</span>
    </div>
  )
}

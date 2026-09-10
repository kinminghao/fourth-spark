import { useEffect, useState } from "react"
import { Clock, Loader2 } from "lucide-react"
import * as api from "../../lib/api-client"
import type { AgentSession } from "../../lib/api-client"
import { formatRelativeTime } from "./agent-utils"

export function SessionList({ agentId }: { agentId: string }) {
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    api.listAgentSessions(agentId)
      .then(data => { if (!cancelled) setSessions(data) })
      .catch(() => { if (!cancelled) setSessions([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [agentId])

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-fg-4" />
        <h2 className="text-sm font-semibold text-fg">Session 历史</h2>
        {!loading && <span className="rounded-full bg-elevated px-1.5 py-0.5 text-[10px] tabular-nums text-fg-4">{sessions.length}</span>}
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 fs-spin text-fg-5" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="py-8 text-center text-xs text-fg-5">暂无 Session 记录。</p>
        ) : (
          <div className="space-y-1">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border border-line bg-base px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-fg">{s.title || s.id.slice(-8)}</span>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-5">
                    <span>{formatRelativeTime(s.timeCreated)}</span>
                    {s.cost > 0 && (
                      <>
                        <span>·</span>
                        <span>${s.cost.toFixed(4)}</span>
                      </>
                    )}
                    {(s.tokensInput > 0 || s.tokensOutput > 0) && (
                      <>
                        <span>·</span>
                        <span>{Math.round((s.tokensInput + s.tokensOutput) / 1000)}K tokens</span>
                      </>
                    )}
                  </div>
                </div>
                {s.completedAt ? (
                  <span className="shrink-0 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">完成</span>
                ) : (
                  <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[10px] font-medium text-fg-5">进行中</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

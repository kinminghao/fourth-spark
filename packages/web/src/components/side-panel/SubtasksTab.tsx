import clsx from "clsx"
import type { Session } from "../../lib/api-client"
import { useSessionStore } from "../../stores/session-store"

const AGENT_COLORS: Record<string, string> = {
  "visual-engineering": "bg-purple-500/15 text-purple-400",
  quick: "bg-emerald-500/15 text-emerald-400",
  deep: "bg-blue-500/15 text-blue-400",
  ultrabrain: "bg-amber-500/15 text-amber-400",
  artistry: "bg-pink-500/15 text-pink-400",
  writing: "bg-cyan-500/15 text-cyan-400",
  explore: "bg-teal-500/15 text-teal-400",
  librarian: "bg-indigo-500/15 text-indigo-400",
  oracle: "bg-amber-500/15 text-amber-400",
  metis: "bg-rose-500/15 text-rose-400",
  momus: "bg-orange-500/15 text-orange-400",
}

function subtaskStatusDot(status: string | undefined): string {
  switch (status) {
    case "idle": return "bg-emerald-500"
    case "busy": case "retry": return "bg-amber-500 animate-pulse"
    case "error": return "bg-red-500"
    default: return "bg-fg-5"
  }
}

function subtaskCreatedMs(session: Session): number | null {
  const raw = session.time?.created
  if (raw) return raw < 1_000_000_000_000 ? raw * 1000 : raw
  if (session.createdAt) {
    const parsed = Date.parse(session.createdAt)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

function formatElapsed(ms: number): string {
  const diff = Date.now() - ms
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return "just now"
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function SubtasksTab() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sessionStatuses = useSessionStore((s) => s.sessionStatuses)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const parentId = activeSession?.parentID ?? activeSessionId
  const isSiblingView = !!activeSession?.parentID

  const children = sessions
    .filter((s) => s.parentID === parentId)
    .sort((a, b) => (subtaskCreatedMs(b) ?? 0) - (subtaskCreatedMs(a) ?? 0))

  if (children.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="font-mono text-xs text-fg-5">暂无子任务</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2">
      {isSiblingView && (
        <div className="mb-1.5 px-2 font-mono text-[10px] text-fg-5">
          同级子任务 ({children.length})
        </div>
      )}
      <ul className="space-y-0.5">
        {children.map((child) => {
          const isCurrent = child.id === activeSessionId
          const status = sessionStatuses[child.id]
          const created = subtaskCreatedMs(child)
          const agentColor = (child.agent && AGENT_COLORS[child.agent]) ?? "bg-elevated text-fg-4"
          const title = child.title || `${child.id.slice(0, 9)}...`
          return (
            <li key={child.id}>
              <button
                type="button"
                onClick={() => { if (!isCurrent) void setActiveSession(child.id) }}
                className={clsx(
                  "group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  isCurrent
                    ? "border-l-2 border-blue-500 bg-blue-500/5"
                    : "border-l-2 border-transparent hover:bg-elevated/60",
                )}
              >
                <span className={clsx("mt-1 h-2 w-2 shrink-0 rounded-full", subtaskStatusDot(status))} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {child.agent && (
                      <span className={clsx("shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-medium", agentColor)}>
                        {child.agent}
                      </span>
                    )}
                    {created != null && (
                      <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-fg-6">
                        {formatElapsed(created)}
                      </span>
                    )}
                  </div>
                  <p className={clsx(
                    "mt-0.5 line-clamp-2 text-xs leading-5",
                    isCurrent ? "text-fg-2" : "text-fg-3 group-hover:text-fg-2",
                  )}>
                    {title}
                  </p>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

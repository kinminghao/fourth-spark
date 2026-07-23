import { useState } from "react"
import { Check, Copy, Trash2, X } from "lucide-react"
import clsx from "clsx"
import type { Session } from "../lib/api-client"
import { useSessionStore } from "../stores/session-store"
import { useRepoStore } from "../stores/repo-store"
import { RunView } from "../components/RunView"

function sessionTime(session: Session): number {
  if (typeof session.time?.created === "number") return session.time.created
  if (session.createdAt) {
    const parsed = Date.parse(session.createdAt)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

function formatWhen(session: Session): string {
  const raw = sessionTime(session)
  if (!raw) return ""
  const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw
  const date = new Date(ms)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function statusDotClass(status: string | undefined): string {
  switch (status) {
    case "idle": return "bg-emerald-500"
    case "busy": case "retry": return "bg-amber-500 animate-pulse"
    case "error": return "bg-red-500"
    default: return "bg-fg-5"
  }
}

function SessionPanel() {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const statuses = useSessionStore((s) => s.sessionStatuses)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)

  const ordered = [...sessions]
    .filter((s) => !s.parentID)
    .sort((a, b) => sessionTime(b) - sessionTime(a))

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">运行记录</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {!activeRepoId ? (
          <p className="px-2 py-6 text-center font-mono text-xs text-fg-5">请先选择一个仓库</p>
        ) : ordered.length === 0 ? (
          <p className="px-2 py-6 text-center font-mono text-xs text-fg-5">暂无运行记录，在右侧输入开始</p>
        ) : (
          <ul className="space-y-0.5">
            {ordered.map((session) => {
              const isActive = session.id === activeSessionId
              const isConfirming = confirmingId === session.id
              const when = formatWhen(session)
              return (
                <li key={session.id}>
                  <div className={clsx(
                    "group relative rounded-md border-l-2 transition-colors",
                    isActive ? "border-blue-500 bg-elevated/80" : "border-transparent hover:bg-elevated/50",
                  )}>
                    <button type="button" onClick={() => void setActiveSession(session.id)} className="block w-full px-2.5 py-2 text-left">
                      <div className="flex items-center gap-2">
                        <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(statuses.get(session.id)))} />
                        <span className="min-w-0 truncate font-mono text-xs text-fg-3">{session.agent?.trim() || "默认"}</span>
                        {when && <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-fg-5">{when}</span>}
                      </div>
                      <div className="mt-0.5 truncate pl-3.5 text-sm text-fg-2">{session.title?.trim() || "未命名运行"}</div>
                    </button>
                    {isConfirming ? (
                      <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-surface/90 px-0.5">
                        <button type="button" onClick={() => { void deleteSession(session.id); setConfirmingId(null) }} className="rounded p-1 text-red-400 hover:bg-red-500/10"><Check className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => setConfirmingId(null)} className="rounded p-1 text-fg-3 hover:bg-elevated"><X className="h-3.5 w-3.5" /></button>
                      </span>
                    ) : (
                      <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => {
                            const json = JSON.stringify({ id: session.id, name: session.title?.trim() || "" }, null, 2)
                            void navigator.clipboard.writeText(json)
                          }}
                          title="复制 Session JSON"
                          className="rounded p-1 text-fg-5 hover:text-fg-2"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => setConfirmingId(session.id)} className="rounded p-1 text-fg-5 hover:text-red-400">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export function RunPage() {
  return (
    <div className="flex min-h-0 flex-1">
      <SessionPanel />
      <div className="flex min-w-0 flex-1 flex-col">
        <RunView />
      </div>
    </div>
  )
}

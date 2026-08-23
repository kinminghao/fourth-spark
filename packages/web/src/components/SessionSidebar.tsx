import { Activity } from "lucide-react"
import clsx from "clsx"
import type { Session } from "../lib/api-client"
import { useIssueStore } from "../stores/issue-store"

export function formatSessionTime(session: Session): string {
  const raw = typeof session.time?.created === "number"
    ? session.time.created
    : session.createdAt
      ? Date.parse(session.createdAt)
      : 0
  if (!raw || Number.isNaN(raw)) return ""
  const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw
  const date = new Date(ms)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function SidebarSessionItem({ session, onSelect }: { session: Session; onSelect: () => void }) {
  const when = formatSessionTime(session)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="block w-full rounded-md border-l-2 border-transparent px-2.5 py-2 text-left transition-colors hover:bg-elevated/50"
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate font-mono text-xs text-fg-3">{session.agent?.trim() || "默认"}</span>
          {when && <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-fg-5">{when}</span>}
        </div>
        <div className="mt-0.5 truncate text-sm text-fg-2">{session.title?.trim() || "未命名运行"}</div>
      </button>
    </li>
  )
}

export function SidebarSessionList({
  sessions,
  onSelect,
}: {
  sessions: Session[]
  onSelect: (sessionId: string) => void
}) {
  const issues = useIssueStore((s) => s.issues)
  const issueMap = new Map(issues.map((i) => [i.id, i]))

  const grouped = new Map<string, Session[]>()
  const unlinked: Session[] = []
  for (const s of sessions) {
    if (s.issueId && issueMap.has(s.issueId)) {
      const list = grouped.get(s.issueId) ?? []
      list.push(s)
      grouped.set(s.issueId, list)
    } else {
      unlinked.push(s)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-3">
        <Activity className="h-3.5 w-3.5 text-fg-5" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-4">
          运行记录
        </span>
        <span className="ml-auto rounded-full bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">
          {sessions.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sessions.length === 0 ? (
          <p className="px-2 py-4 text-center font-mono text-[10px] text-fg-6">暂无运行记录</p>
        ) : (
          <div className="space-y-3">
            {[...grouped.entries()].map(([gid, list]) => {
              const issue = issueMap.get(gid)!
              return (
                <div key={gid}>
                  <div className="mb-1 flex items-center gap-1.5 px-1">
                    <span className={clsx(
                      "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium",
                      issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
                    )}>
                      #{issue.number}
                    </span>
                    <span className="min-w-0 truncate text-xs font-medium text-fg-3">{issue.title}</span>
                  </div>
                  <ul className="space-y-0.5">
                    {list.map((s) => (
                      <SidebarSessionItem key={s.id} session={s} onSelect={() => onSelect(s.id)} />
                    ))}
                  </ul>
                </div>
              )
            })}
            {unlinked.length > 0 && (
              <div>
                {grouped.size > 0 && (
                  <div className="mb-1 px-1">
                    <span className="text-xs font-medium text-fg-5">未关联 Issue</span>
                  </div>
                )}
                <ul className="space-y-0.5">
                  {unlinked.map((s) => (
                    <SidebarSessionItem key={s.id} session={s} onSelect={() => onSelect(s.id)} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function IssueSessionSidebar({
  sessions,
  onSessionSelect,
}: {
  sessions: Session[]
  onSessionSelect: (sessionId: string) => void
}) {
  return (
    <div className="flex w-full flex-col">
      <SidebarSessionList sessions={sessions} onSelect={onSessionSelect} />
    </div>
  )
}

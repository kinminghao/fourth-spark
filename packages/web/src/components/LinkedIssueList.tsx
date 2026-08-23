import { CircleDot } from "lucide-react"
import clsx from "clsx"
import type { Issue } from "../lib/api-client"
import { useSessionStore } from "../stores/session-store"
import { issueStateColor } from "../lib/date-utils"

export function LinkedIssueList({
  issues,
  onSelect,
}: {
  issues: Issue[]
  onSelect: (issueId: string) => void
}) {
  const sessions = useSessionStore((s) => s.sessions)

  const sessionCounts = new Map<string, number>()
  for (const s of sessions) {
    if (s.issueId && !s.parentID) {
      sessionCounts.set(s.issueId, (sessionCounts.get(s.issueId) ?? 0) + 1)
    }
  }

  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-fg-5">
        <CircleDot className="h-8 w-8" />
        <p className="font-mono text-xs">该 PR 没有关联的 Issue</p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {issues.map((issue) => {
        const sessionCount = sessionCounts.get(issue.id) ?? 0
        return (
          <li key={issue.id}>
            <button
              type="button"
              onClick={() => onSelect(issue.id)}
              className="group flex w-full flex-col gap-1.5 rounded-lg border border-line bg-elevated/30 px-4 py-3 text-left transition-colors hover:border-blue-500/40 hover:bg-elevated/60"
            >
              <div className="flex items-center gap-2">
                <span className={clsx("shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold", issueStateColor(issue.state))}>
                  #{issue.number} {issue.state}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-2 group-hover:text-fg">
                  {issue.title}
                </span>
                {sessionCount > 0 && (
                  <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 font-mono text-[10px] text-fg-5">
                    {sessionCount} 次运行
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-5">
                {issue.authorLogin && (
                  <span className="flex items-center gap-1">
                    {issue.authorAvatar && (
                      <img src={issue.authorAvatar} alt="" className="h-3.5 w-3.5 rounded-full" />
                    )}
                    {issue.authorLogin}
                  </span>
                )}
                {issue.labels && issue.labels.length > 0 && issue.labels.map((l) => (
                  <span
                    key={l.id}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: `#${l.color}20`, color: `#${l.color}` }}
                  >
                    {l.name}
                  </span>
                ))}
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

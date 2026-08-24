import { Flag, MessageCircle } from "lucide-react"
import clsx from "clsx"
import type { Issue, Milestone } from "../lib/api-client"
import { relativeTime } from "../lib/date-utils"

export function IssueRow({
  issue,
  sessionCount,
  isActive,
  isEpic,
  milestone,
  onSelect,
}: {
  issue: Issue
  sessionCount: number
  isActive: boolean
  isEpic?: boolean
  milestone?: Milestone
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={clsx(
          "group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
          isActive
            ? "border-l-2 border-blue-500 bg-elevated/80"
            : "border-l-2 border-transparent hover:bg-elevated/50",
        )}
      >
        <span
          className={clsx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold",
            issue.state === "open"
              ? "bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-emerald-400 ring-1 ring-emerald-500/25"
              : "bg-gradient-to-br from-purple-500/20 to-purple-500/5 text-purple-400 ring-1 ring-purple-500/25",
          )}
        >
          {issue.number}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isEpic && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold tracking-wide bg-amber-400/12 text-amber-400">
                EPIC
              </span>
            )}
            <span className="min-w-0 text-xs font-medium text-fg-2 group-hover:text-fg">
              {issue.title}
            </span>
          </div>

          {issue.labels && issue.labels.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {issue.labels.map((l) => (
                <span
                  key={l.id}
                  className="rounded px-1 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: `#${l.color}20`,
                    color: `#${l.color}`,
                  }}
                >
                  {l.name}
                </span>
              ))}
            </div>
          )}

          {milestone && (
            <span className="mt-1 flex items-center gap-1 text-[10px] text-indigo-400/70">
              <Flag className="h-2.5 w-2.5" />
              {milestone.title}
            </span>
          )}
        </div>

        {sessionCount > 0 && (
          <span className="shrink-0 rounded-full bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">
            {sessionCount}
          </span>
        )}
      </button>
    </li>
  )
}

export function FullWidthIssueRow({
  issue,
  sessionCount,
  isEpic,
  milestone,
  onSelect,
}: {
  issue: Issue
  sessionCount: number
  isEpic?: boolean
  milestone?: Milestone
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="group flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-elevated/50"
      >
        <span
          className={clsx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold",
            issue.state === "open"
              ? "bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-emerald-400 ring-1 ring-emerald-500/25"
              : "bg-gradient-to-br from-purple-500/20 to-purple-500/5 text-purple-400 ring-1 ring-purple-500/25",
          )}
        >
          {issue.number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isEpic && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide bg-amber-400/12 text-amber-400">
                EPIC
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-2 group-hover:text-fg">
              {issue.title}
            </span>
            {milestone && (
              <span className="hidden shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-indigo-500/15 text-indigo-400 sm:flex">
                <Flag className="h-2.5 w-2.5" />
                {milestone.title}
              </span>
            )}
            {sessionCount > 0 && (
              <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 font-mono text-[10px] text-fg-5">
                {sessionCount} 次运行
              </span>
            )}
            {issue.assignees && issue.assignees.length > 0 && (
              <div className="hidden shrink-0 items-center -space-x-1.5 sm:flex">
                {issue.assignees.slice(0, 3).map((a) => (
                  <img key={a.login} src={a.avatar_url} alt={a.login} title={a.login} className="h-5 w-5 rounded-full ring-2 ring-surface" />
                ))}
                {issue.assignees.length > 3 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-elevated text-[9px] font-medium text-fg-4 ring-2 ring-surface">
                    +{issue.assignees.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {issue.authorLogin && (
              <span className="shrink-0 text-[11px] text-fg-5" title={issue.authorLogin}>
                {issue.authorAvatar && <img src={issue.authorAvatar} alt="" className="mr-1 inline-block h-3.5 w-3.5 rounded-full align-text-bottom" />}
                {issue.authorLogin}
              </span>
            )}
            {issue.authorLogin && <span className="text-fg-6">·</span>}
            <span className="shrink-0 text-[11px] text-fg-6">{relativeTime(issue.createdAt)}</span>
            {(issue.commentCount ?? 0) > 0 && (
              <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-fg-6">
                <span className="text-fg-6">·</span>
                <MessageCircle className="h-3 w-3" />
                {issue.commentCount}
              </span>
            )}
            {((issue.labels && issue.labels.length > 0) || (issue.commentCount ?? 0) > 0 || issue.authorLogin) && issue.labels && issue.labels.length > 0 && (
              <span className="text-fg-6">·</span>
            )}
            {issue.labels && issue.labels.length > 0 ? (
              issue.labels.map((l) => (
                <span
                  key={l.id}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: `#${l.color}20`,
                    color: `#${l.color}`,
                  }}
                >
                  {l.name}
                </span>
              ))
            ) : !issue.authorLogin ? (
              <span className="text-[11px] text-fg-6">&nbsp;</span>
            ) : null}
          </div>
        </div>
      </button>
    </li>
  )
}

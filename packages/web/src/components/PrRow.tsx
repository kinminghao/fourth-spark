import { AlertTriangle } from "lucide-react"
import clsx from "clsx"
import type { PersistentPullRequest } from "../lib/api-client"
import { relativeTime } from "../lib/date-utils"

export function CompactPrRow({
  pr,
  isActive,
  onSelect,
}: {
  pr: PersistentPullRequest
  isActive: boolean
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
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ring-1",
            pr.state === "merged"
              ? "bg-gradient-to-br from-purple-500/20 to-purple-500/5 text-purple-400 ring-purple-500/25"
              : pr.state === "closed"
                ? "bg-gradient-to-br from-red-500/20 to-red-500/5 text-red-400 ring-red-500/25"
                : "bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-emerald-400 ring-emerald-500/25",
          )}
        >
          {pr.number}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {pr.draft === 1 && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold bg-fg-6/15 text-fg-4">DRAFT</span>
            )}
            <span className="min-w-0 text-xs font-medium text-fg-2 group-hover:text-fg">{pr.title}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-fg-6">
            {pr.headBranch} → {pr.baseBranch}
          </div>
          {pr.labels && pr.labels.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {pr.labels.map((l) => (
                <span
                  key={l.id}
                  className="rounded px-1 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: `#${l.color}20`, color: `#${l.color}` }}
                >
                  {l.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </button>
    </li>
  )
}

export function FullWidthPrRow({
  pr,
  onSelect,
}: {
  pr: PersistentPullRequest
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
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ring-1",
            pr.state === "merged"
              ? "bg-gradient-to-br from-purple-500/20 to-purple-500/5 text-purple-400 ring-purple-500/25"
              : pr.state === "closed"
                ? "bg-gradient-to-br from-red-500/20 to-red-500/5 text-red-400 ring-red-500/25"
                : "bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-emerald-400 ring-emerald-500/25",
          )}
        >
          {pr.number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {pr.draft === 1 && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide bg-fg-6/15 text-fg-4">DRAFT</span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-2 group-hover:text-fg">{pr.title}</span>
            {pr.mergeable === "false" && pr.state === "open" && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-400">
                <AlertTriangle className="inline h-3 w-3 -mt-px" /> Conflict
              </span>
            )}
            {pr.assignees && pr.assignees.length > 0 && (
              <div className="hidden shrink-0 items-center -space-x-1.5 sm:flex">
                {pr.assignees.slice(0, 3).map((a) => (
                  <img key={a.login} src={a.avatar_url} alt={a.login} title={a.login} className="h-5 w-5 rounded-full ring-2 ring-surface" />
                ))}
              </div>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="shrink-0 font-mono text-[11px] text-fg-5">{pr.headBranch} → {pr.baseBranch}</span>
            <span className="text-fg-6">·</span>
            {pr.authorLogin && (
              <>
                <span className="shrink-0 text-[11px] text-fg-5" title={pr.authorLogin}>
                  {pr.authorAvatar && <img src={pr.authorAvatar} alt="" className="mr-1 inline-block h-3.5 w-3.5 rounded-full align-text-bottom" />}
                  {pr.authorLogin}
                </span>
                <span className="text-fg-6">·</span>
              </>
            )}
            <span className="shrink-0 text-[11px] text-fg-6">{relativeTime(pr.createdAt)}</span>
            {pr.labels && pr.labels.length > 0 && (
              <>
                <span className="text-fg-6">·</span>
                {pr.labels.map((l) => (
                  <span
                    key={l.id}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: `#${l.color}20`, color: `#${l.color}` }}
                  >
                    {l.name}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
      </button>
    </li>
  )
}

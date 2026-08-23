import { AlertTriangle, GitPullRequest } from "lucide-react"
import clsx from "clsx"
import type { PullRequest } from "../lib/api-client"
import { prStateColor } from "../lib/date-utils"

export function LinkedPrList({
  prs,
  onSelect,
}: {
  prs: PullRequest[]
  onSelect: (prNumber: number) => void
}) {
  if (prs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-fg-5">
        <GitPullRequest className="h-8 w-8" />
        <p className="font-mono text-xs">该 Issue 没有关联的 PR</p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {prs.map((pr) => (
        <li key={pr.number}>
          <button
            type="button"
            onClick={() => onSelect(pr.number)}
            className="group flex w-full flex-col gap-1.5 rounded-lg border border-line bg-elevated/30 px-4 py-3 text-left transition-colors hover:border-blue-500/40 hover:bg-elevated/60"
          >
            <div className="flex items-center gap-2">
              <span className={clsx("shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold", prStateColor(pr.state))}>
                #{pr.number} {pr.state}
              </span>
              {pr.mergeable === false && (
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-400">
                  <AlertTriangle className="inline h-3 w-3 -mt-px" /> Conflict
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-2 group-hover:text-fg">
                {pr.title}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-5">
              {pr.user?.login && (
                <span className="flex items-center gap-1">
                  {pr.user.avatar_url && (
                    <img src={pr.user.avatar_url} alt="" className="h-3.5 w-3.5 rounded-full" />
                  )}
                  {pr.user.login}
                </span>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

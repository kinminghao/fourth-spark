import { useLocation, useNavigate } from "react-router-dom"
import { CircleDot, GitPullRequest } from "lucide-react"
import clsx from "clsx"
import { useIssueStore } from "../stores/issue-store"
import { usePrStore } from "../stores/pr-store"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { IssuesPage } from "./IssuesPage"
import { PullRequestsPage } from "./PullRequestsPage"

type Segment = "issues" | "pulls"

function pathForSegment(repoName: string | null, segment: Segment): string {
  if (!repoName) return `/dev/${segment}`
  return `/${encodeURIComponent(repoName)}/dev/${segment}`
}

export function DevPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const repoName = useRepoStore(selectActiveRepoName)
  const issues = useIssueStore((s) => s.issues)
  const pulls = usePrStore((s) => s.pulls)

  const segment: Segment = location.pathname.endsWith("/pulls") ? "pulls" : "issues"

  const openIssueCount = issues.filter((i) => i.state === "open").length
  const openPrCount = pulls.filter((p) => p.state === "open").length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-3 py-2">
        <div className="flex items-center rounded-lg bg-elevated/60 p-0.5">
          <button
            type="button"
            onClick={() => navigate(pathForSegment(repoName, "issues"))}
            className={clsx(
              "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
              segment === "issues"
                ? "bg-surface text-fg shadow-sm"
                : "text-fg-4 hover:text-fg-2",
            )}
          >
            <CircleDot className="h-3.5 w-3.5" />
            Issues
            <span className={clsx(
              "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
              segment === "issues" ? "bg-blue-500/10 text-blue-500" : "text-fg-5",
            )}>
              {openIssueCount}
            </span>
          </button>
          <button
            type="button"
            onClick={() => navigate(pathForSegment(repoName, "pulls"))}
            className={clsx(
              "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
              segment === "pulls"
                ? "bg-surface text-fg shadow-sm"
                : "text-fg-4 hover:text-fg-2",
            )}
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            PRs
            <span className={clsx(
              "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
              segment === "pulls" ? "bg-blue-500/10 text-blue-500" : "text-fg-5",
            )}>
              {openPrCount}
            </span>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {segment === "issues" ? <IssuesPage /> : <PullRequestsPage />}
      </div>
    </div>
  )
}

import { useEffect, useState } from "react"
import { AlertTriangle, ArrowLeft, CircleDot, GitPullRequest } from "lucide-react"
import clsx from "clsx"
import { type Issue, type Milestone, type PersistentPullRequest, type PullRequest, listIssuePullRequests, getPull } from "../lib/api-client"
import { useRepoStore } from "../stores/repo-store"
import { usePrStore } from "../stores/pr-store"
import { IssueDetailPanel } from "./IssueDetailPanel"
import { PrDetailPanel } from "./PrDetailPanel"
import { LinkedPrList } from "./LinkedPrList"

export type DetailTab = "issue" | "pr"

export function IssueDetailWithTabs({
  issue,
  milestone,
  tab,
  prNumber,
  onTabChange,
  onSelectPr,
  onBackToPrList,
  onBack,
  onClose,
  onToggleSidebar,
}: {
  issue: Issue
  milestone?: Milestone
  tab: DetailTab
  prNumber: number | null
  onTabChange: (tab: DetailTab) => void
  onSelectPr: (prNumber: number) => void
  onBackToPrList: () => void
  onBack?: () => void
  onClose?: () => void
  onToggleSidebar?: () => void
}) {
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const enterMatchMode = usePrStore((s) => s.enterMatchMode)
  const [linkedPRs, setLinkedPRs] = useState<PullRequest[]>([])
  const [selectedPr, setSelectedPr] = useState<PersistentPullRequest | null>(null)
  const [loadingPr, setLoadingPr] = useState(false)

  useEffect(() => {
    if (!activeRepoId) {
      setLinkedPRs([])
      return
    }
    listIssuePullRequests(activeRepoId, issue.number)
      .then(setLinkedPRs)
      .catch(() => setLinkedPRs([]))
  }, [activeRepoId, issue.number])

  useEffect(() => {
    if (!activeRepoId || prNumber == null) {
      setSelectedPr(null)
      return
    }
    let cancelled = false
    setLoadingPr(true)
    getPull(activeRepoId, prNumber)
      .then((pr) => { if (!cancelled) setSelectedPr(pr) })
      .catch(() => { if (!cancelled) setSelectedPr(null) })
      .finally(() => { if (!cancelled) setLoadingPr(false) })
    return () => { cancelled = true }
  }, [activeRepoId, prNumber])

  const hasConflict = linkedPRs.some((p) => p.mergeable === false)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {linkedPRs.length > 0 && (
        <div className="flex shrink-0 items-center border-b border-line bg-surface">
          <button
            type="button"
            onClick={() => onTabChange("issue")}
            className={clsx(
              "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors",
              tab === "issue"
                ? "border-blue-500 text-fg"
                : "border-transparent text-fg-4 hover:text-fg-2",
            )}
          >
            <CircleDot className="h-3.5 w-3.5" />
            Issue
          </button>
          <button
            type="button"
            onClick={() => onTabChange("pr")}
            className={clsx(
              "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors",
              tab === "pr"
                ? "border-blue-500 text-fg"
                : "border-transparent text-fg-4 hover:text-fg-2",
            )}
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            PR
            <span className={clsx(
              "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
              tab === "pr" ? "bg-blue-500/10 text-blue-500" : "bg-elevated text-fg-5",
            )}>
              {linkedPRs.length}
            </span>
            {hasConflict && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-400">
                <AlertTriangle className="inline h-3 w-3 -mt-px" /> Conflict
              </span>
            )}
          </button>
        </div>
      )}

      {tab === "issue" || linkedPRs.length === 0 ? (
        <IssueDetailPanel
          issue={issue}
          milestone={milestone}
          onBack={onBack}
          onClose={onClose}
          onToggleSidebar={onToggleSidebar}
        />
      ) : prNumber != null ? (
        selectedPr ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center border-b border-line bg-elevated/30 px-4 py-2">
              <button
                type="button"
                onClick={onBackToPrList}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                返回列表
              </button>
            </div>
            <PrDetailPanel
              pr={selectedPr}
              onBack={onBackToPrList}
              onEnterMatch={() => enterMatchMode(selectedPr.id)}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="font-mono text-xs text-fg-5">{loadingPr ? "加载 PR…" : "PR 未找到"}</p>
          </div>
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
            <LinkedPrList prs={linkedPRs} onSelect={onSelectPr} />
          </div>
        </div>
      )}
    </div>
  )
}

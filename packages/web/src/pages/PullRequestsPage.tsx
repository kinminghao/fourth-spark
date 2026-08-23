import { useCallback, useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  ArrowLeft,
  CircleDot,
  GitPullRequest,
  Link2,
  RefreshCw,
  Search,
  X,
} from "lucide-react"
import clsx from "clsx"
import { listPrLinkedIssues, type Issue, type PersistentPullRequest } from "../lib/api-client"
import { usePrStore } from "../stores/pr-store"
import { useIssueStore } from "../stores/issue-store"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { PrDetailPanel } from "../components/PrDetailPanel"
import { IssueDetailPanel } from "../components/IssueDetailPanel"
import { LinkedIssueList } from "../components/LinkedIssueList"
import { CompactPrRow, FullWidthPrRow } from "../components/PrRow"

type PrDetailTab = "pr" | "issue"

type StateFilter = "open" | "closed" | "merged" | "all"

const STATE_FILTERS: { key: StateFilter; label: string }[] = [
  { key: "open", label: "开放" },
  { key: "merged", label: "已合并" },
  { key: "closed", label: "已关闭" },
  { key: "all", label: "全部" },
]

function IssueMatchRow({
  issue,
  linked,
  onToggle,
}: {
  issue: Issue
  linked: boolean
  onToggle: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={clsx(
          "group flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left transition-colors",
          linked
            ? "border-l-2 border-emerald-500 bg-emerald-500/5"
            : "border-l-2 border-transparent hover:bg-elevated/50",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={clsx(
                "shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-medium",
                issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
              )}
            >
              #{issue.number}
            </span>
            <span className="min-w-0 truncate text-sm font-medium text-fg-2">{issue.title}</span>
            {linked && <Link2 className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-400" />}
          </div>
        </div>
      </button>
    </li>
  )
}

function PrDetailWithTabs({
  pr,
  tab,
  issueId,
  onTabChange,
  onSelectIssue,
  onBackToIssueList,
  onBack,
  onClose,
  onEnterMatch,
  onNavigateToIssue,
}: {
  pr: PersistentPullRequest
  tab: PrDetailTab
  issueId: string | null
  onTabChange: (tab: PrDetailTab) => void
  onSelectIssue: (issueId: string) => void
  onBackToIssueList: () => void
  onBack?: () => void
  onClose?: () => void
  onEnterMatch: () => void
  onNavigateToIssue?: (issueId: string) => void
}) {
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const allIssues = useIssueStore((s) => s.issues)
  const [linkedIssues, setLinkedIssues] = useState<Issue[]>([])

  useEffect(() => {
    if (!activeRepoId) {
      setLinkedIssues([])
      return
    }
    listPrLinkedIssues(activeRepoId, pr.number)
      .then(setLinkedIssues)
      .catch(() => setLinkedIssues([]))
  }, [activeRepoId, pr.number])

  const selectedIssue = issueId ? allIssues.find((i) => i.id === issueId) ?? linkedIssues.find((i) => i.id === issueId) ?? null : null

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {linkedIssues.length > 0 && (
        <div className="flex shrink-0 items-center border-b border-line bg-surface">
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
          </button>
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
            <span className={clsx(
              "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
              tab === "issue" ? "bg-blue-500/10 text-blue-500" : "bg-elevated text-fg-5",
            )}>
              {linkedIssues.length}
            </span>
          </button>
        </div>
      )}

      {tab === "pr" || linkedIssues.length === 0 ? (
        <PrDetailPanel
          pr={pr}
          onBack={onBack}
          onClose={onClose}
          onEnterMatch={onEnterMatch}
          onNavigateToIssue={onNavigateToIssue}
        />
      ) : selectedIssue ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center border-b border-line bg-elevated/30 px-4 py-2">
            <button
              type="button"
              onClick={onBackToIssueList}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回列表
            </button>
          </div>
          <IssueDetailPanel
            issue={selectedIssue}
            onBack={onBackToIssueList}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
            <LinkedIssueList issues={linkedIssues} onSelect={onSelectIssue} />
          </div>
        </div>
      )}
    </div>
  )
}

export function PullRequestsPage() {
  const [stateFilter, setStateFilter] = useState<StateFilter>("open")
  const [searchQuery, setSearchQuery] = useState("")
  const [issueSearchQuery, setIssueSearchQuery] = useState("")
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const repoName = useRepoStore(selectActiveRepoName)

  const pulls = usePrStore((s) => s.pulls)
  const syncing = usePrStore((s) => s.syncing)
  const syncPulls = usePrStore((s) => s.syncPulls)
  const matchingPrId = usePrStore((s) => s.matchingPrId)
  const enterMatchMode = usePrStore((s) => s.enterMatchMode)
  const exitMatchMode = usePrStore((s) => s.exitMatchMode)
  const linkIssue = usePrStore((s) => s.linkIssue)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const allIssues = useIssueStore((s) => s.issues)

  const selectedId = searchParams.get("id")
  const tab: PrDetailTab = searchParams.get("tab") === "issue" ? "issue" : "pr"
  const issueId = searchParams.get("issueId")

  useEffect(() => {
    const legacy = searchParams.get("prId")
    if (!legacy) return
    const next = new URLSearchParams(searchParams)
    next.delete("prId")
    next.set("id", legacy)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const openPr = useCallback((id: string) => {
    setSearchParams({ id }, { replace: false })
  }, [setSearchParams])

  const closePr = useCallback(() => {
    setSearchParams({}, { replace: false })
  }, [setSearchParams])

  const changeTab = useCallback((newTab: PrDetailTab) => {
    if (!selectedId) return
    const params: Record<string, string> = { id: selectedId }
    if (newTab === "issue") params.tab = "issue"
    setSearchParams(params, { replace: false })
  }, [selectedId, setSearchParams])

  const openIssueTab = useCallback((iid: string) => {
    if (!selectedId) return
    setSearchParams({ id: selectedId, tab: "issue", issueId: iid }, { replace: false })
  }, [selectedId, setSearchParams])

  const backToIssueList = useCallback(() => {
    if (!selectedId) return
    setSearchParams({ id: selectedId, tab: "issue" }, { replace: false })
  }, [selectedId, setSearchParams])

  const matchingPr = matchingPrId ? pulls.find((p) => p.id === matchingPrId) ?? null : null

  const [linkedIssueIds, setLinkedIssueIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!activeRepoId || !matchingPr) {
      setLinkedIssueIds(new Set())
      return
    }
    listPrLinkedIssues(activeRepoId, matchingPr.number)
      .then((linked) => setLinkedIssueIds(new Set(linked.map((i) => i.id))))
      .catch(() => setLinkedIssueIds(new Set()))
  }, [activeRepoId, matchingPr])

  const handleToggleLink = async (issue: Issue) => {
    if (!matchingPr) return
    const isLinked = linkedIssueIds.has(issue.id)
    if (isLinked) {
      const ok = await usePrStore.getState().unlinkIssue(matchingPr.number, issue.number)
      if (ok) setLinkedIssueIds((prev) => { const next = new Set(prev); next.delete(issue.id); return next })
    } else {
      const ok = await linkIssue(matchingPr.number, issue.number)
      if (ok) setLinkedIssueIds((prev) => new Set(prev).add(issue.id))
    }
  }

  const openCount = pulls.filter((p) => p.state === "open").length
  const mergedCount = pulls.filter((p) => p.state === "merged").length
  const closedCount = pulls.filter((p) => p.state === "closed").length

  const afterState = stateFilter === "all" ? pulls : pulls.filter((p) => p.state === stateFilter)
  const sq = searchQuery.trim().toLowerCase()
  const filtered = !sq
    ? afterState
    : afterState.filter((p) => `#${p.number} ${p.title} ${p.headBranch} ${p.baseBranch}`.toLowerCase().includes(sq))

  const isq = issueSearchQuery.trim().toLowerCase()
  const filteredIssues = !isq
    ? allIssues
    : allIssues.filter((i) => `#${i.number} ${i.title}`.toLowerCase().includes(isq))

  const selectedPr = pulls.find((p) => p.id === selectedId) ?? null
  const showDetail = matchingPr ?? selectedPr

  return (
    <div className="flex min-h-0 flex-1">
      <div
        className={clsx(
          "shrink-0 flex-col bg-surface",
          showDetail
            ? "hidden md:flex md:w-80 border-r border-line"
            : "flex w-full",
        )}
      >
        {matchingPrId ? (
          <>
            <div className="flex items-center justify-between border-b border-line px-3 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">选择 Issue 关联</span>
              <button
                type="button"
                onClick={exitMatchMode}
                className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
              >
                <X className="h-3.5 w-3.5" />
                完成
              </button>
            </div>
            <div className="border-b border-line px-3 py-2">
              <div className="flex items-center gap-2 rounded-md border border-line bg-base px-2 py-1">
                <Search className="h-3.5 w-3.5 shrink-0 text-fg-5" />
                <input
                  type="text"
                  value={issueSearchQuery}
                  onChange={(e) => setIssueSearchQuery(e.target.value)}
                  placeholder="搜索 issue..."
                  className="min-w-0 flex-1 bg-transparent font-mono text-xs text-fg placeholder:text-fg-6 focus:outline-none"
                />
                {issueSearchQuery && (
                  <button type="button" onClick={() => setIssueSearchQuery("")} className="shrink-0 text-fg-5 hover:text-fg-3">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {filteredIssues.length === 0 ? (
                <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">
                  {allIssues.length === 0 ? "暂无 Issue，请先同步" : "无匹配 Issue"}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {filteredIssues.map((issue) => (
                    <IssueMatchRow
                      key={issue.id}
                      issue={issue}
                      linked={linkedIssueIds.has(issue.id)}
                      onToggle={() => void handleToggleLink(issue)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : !showDetail ? (
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-line px-4 py-2.5">
              {/* Title */}
              <span className="shrink-0 text-sm font-semibold text-fg md:order-1">Pull Requests</span>
              {/* Sync: right-aligned on mobile, end of row on desktop */}
              <button
                type="button"
                onClick={() => void syncPulls()}
                disabled={syncing || !activeRepoId}
                title="同步 PR"
                className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-2 disabled:opacity-40 md:order-last md:ml-0"
              >
                <RefreshCw className={clsx("h-4 w-4", syncing && "animate-spin")} />
              </button>
              {/* State filters: new row on mobile */}
              <div className="w-full md:order-2 md:w-auto">
                <div className="flex shrink-0 items-center rounded-lg bg-elevated/60 p-0.5">
                  {STATE_FILTERS.map(({ key, label }) => {
                    const count = key === "open" ? openCount : key === "merged" ? mergedCount : key === "closed" ? closedCount : pulls.length
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setStateFilter(key)}
                        className={clsx(
                          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          stateFilter === key
                            ? "bg-surface text-fg shadow-sm"
                            : "text-fg-4 hover:text-fg-2",
                        )}
                      >
                        {label}
                        <span className={clsx(
                          "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                          stateFilter === key ? "bg-blue-500/10 text-blue-500" : "text-fg-5",
                        )}>
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
              {/* Search: new row on mobile, inline on desktop */}
              <div className="w-full md:order-3 md:w-auto md:min-w-0 md:flex-1 md:px-1">
                <div className="flex items-center gap-2 rounded-md border border-line bg-base px-2.5 py-1.5">
                  <Search className="h-3.5 w-3.5 shrink-0 text-fg-5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索 PR..."
                    className="min-w-0 flex-1 bg-transparent text-xs text-fg placeholder:text-fg-6 focus:outline-none"
                  />
                  {searchQuery && (
                    <button type="button" onClick={() => setSearchQuery("")} className="shrink-0 text-fg-5 hover:text-fg-3">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-line px-3 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">Pull Requests</span>
              {activeRepoId && (
                <button
                  type="button"
                  onClick={() => void syncPulls()}
                  disabled={syncing}
                  title="同步"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2 disabled:opacity-40"
                >
                  <RefreshCw className={clsx("h-3.5 w-3.5", syncing && "animate-spin")} />
                </button>
              )}
            </div>
            <div className="flex border-b border-line">
              {STATE_FILTERS.map(({ key, label }) => {
                const count = key === "open" ? openCount : key === "merged" ? mergedCount : key === "closed" ? closedCount : pulls.length
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStateFilter(key)}
                    className={clsx(
                      "flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors",
                      stateFilter === key
                        ? "border-b-2 border-blue-500 text-blue-500"
                        : "text-fg-4 hover:text-fg-2",
                    )}
                  >
                    {label}
                    <span className={clsx(
                      "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                      stateFilter === key ? "bg-blue-500/10 text-blue-500" : "bg-elevated text-fg-5",
                    )}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="border-b border-line px-3 py-2">
              <div className="flex items-center gap-2 rounded-md border border-line bg-base px-2 py-1">
                <Search className="h-3.5 w-3.5 shrink-0 text-fg-5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索 PR..."
                  className="min-w-0 flex-1 bg-transparent font-mono text-xs text-fg placeholder:text-fg-6 focus:outline-none"
                />
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery("")} className="shrink-0 text-fg-5 hover:text-fg-3">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {!matchingPrId && (
          <div className={clsx("flex-1 overflow-y-auto", showDetail ? "px-2 py-2" : "px-3 py-3")}>
            {!activeRepoId ? (
              <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">请先选择一个仓库</p>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-fg-5">
                <GitPullRequest className="h-8 w-8" />
                <p className="font-mono text-xs">{pulls.length === 0 ? "点击 ↻ 同步 PR" : "没有匹配的 PR"}</p>
              </div>
            ) : (
              <ul className={clsx(showDetail ? "space-y-0.5" : "space-y-1")}>
                {filtered.map((pr) =>
                  showDetail ? (
                    <CompactPrRow
                      key={pr.id}
                      pr={pr}
                      isActive={pr.id === (selectedId ?? matchingPrId)}
                      onSelect={() => openPr(pr.id)}
                    />
                  ) : (
                    <FullWidthPrRow
                      key={pr.id}
                      pr={pr}
                      onSelect={() => openPr(pr.id)}
                    />
                  ),
                )}
              </ul>
            )}
          </div>
        )}
      </div>

      {showDetail ? (
        <PrDetailWithTabs
          key={`${showDetail.id}-${matchingPrId ?? "view"}`}
          pr={showDetail}
          tab={tab}
          issueId={issueId}
          onTabChange={changeTab}
          onSelectIssue={openIssueTab}
          onBackToIssueList={backToIssueList}
          onBack={() => { closePr(); if (matchingPrId) exitMatchMode() }}
          onClose={() => { closePr(); if (matchingPrId) exitMatchMode() }}
          onEnterMatch={() => enterMatchMode(showDetail.id)}
          onNavigateToIssue={(iid) => {
            if (!repoName) return
            navigate(`/${encodeURIComponent(repoName)}/dev/issues?id=${encodeURIComponent(iid)}`)
          }}
        />
      ) : (
        <div className="hidden flex-1 items-center justify-center md:flex">
          <div className="text-center text-fg-5">
            <GitPullRequest className="mx-auto h-12 w-12 opacity-20" />
            <p className="mt-3 font-mono text-xs">选择一个 PR 查看详情</p>
          </div>
        </div>
      )}
    </div>
  )
}

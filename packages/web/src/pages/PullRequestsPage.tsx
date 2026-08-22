import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  AlertTriangle,
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
import { relativeTime } from "../lib/date-utils"

type StateFilter = "open" | "closed" | "merged" | "all"

const STATE_FILTERS: { key: StateFilter; label: string }[] = [
  { key: "open", label: "开放" },
  { key: "merged", label: "已合并" },
  { key: "closed", label: "已关闭" },
  { key: "all", label: "全部" },
]

function CompactPrRow({
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

function FullWidthPrRow({
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

export function PullRequestsPage() {
  const [stateFilter, setStateFilter] = useState<StateFilter>("open")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

  useEffect(() => {
    const paramId = searchParams.get("prId")
    if (paramId && pulls.some((p) => p.id === paramId)) {
      setSelectedId(paramId)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams, pulls])

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
                      onSelect={() => setSelectedId(pr.id)}
                    />
                  ) : (
                    <FullWidthPrRow
                      key={pr.id}
                      pr={pr}
                      onSelect={() => setSelectedId(pr.id)}
                    />
                  ),
                )}
              </ul>
            )}
          </div>
        )}
      </div>

      {showDetail ? (
        <PrDetailPanel
          key={`${showDetail.id}-${matchingPrId ?? "view"}`}
          pr={showDetail}
          onBack={() => { setSelectedId(null); if (matchingPrId) exitMatchMode() }}
          onClose={() => { setSelectedId(null); if (matchingPrId) exitMatchMode() }}
          onEnterMatch={() => enterMatchMode(showDetail.id)}
          onNavigateToIssue={(issueId) => {
            if (!repoName) return
            navigate(`/${encodeURIComponent(repoName)}/dev/issues?id=${encodeURIComponent(issueId)}`)
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

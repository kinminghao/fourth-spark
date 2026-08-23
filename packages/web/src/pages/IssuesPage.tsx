import { useEffect, useState, useCallback, useMemo } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { RefreshCw, Search, X } from "lucide-react"
import clsx from "clsx"
import { useIssueStore } from "../stores/issue-store"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { useSessionStore } from "../stores/session-store"
import { useSwipeDrawer } from "../hooks/use-swipe-drawer"
import { useIssueFilters } from "../hooks/use-issue-filters"
import { SwipeDrawer } from "../components/SwipeDrawer"
import { IssueDetailWithTabs, type DetailTab } from "../components/IssueDetailWithTabs"
import { IssueCreateForm } from "../components/IssueCreateForm"
import { IssueRow, FullWidthIssueRow } from "../components/IssueRow"
import { IssueTreeSidebar } from "../components/IssueTree"
import { IssueSessionSidebar } from "../components/SessionSidebar"
import { IssueFilters, STATE_FILTERS, type StateFilter, type TypeFilter, type ExpandedFilter } from "../components/IssueFilters"

export function IssuesPage() {
  const [stateFilter, setStateFilter] = useState<StateFilter>("open")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("stray")
  const [creating, setCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [treeRootId, setTreeRootId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [listDrawerOpen, setListDrawerOpen] = useState(false)
  const [expandedFilter, setExpandedFilter] = useState<ExpandedFilter>(null)
  const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null)
  const [selectedAssignee, setSelectedAssignee] = useState<string | null>(null)

  const [searchParams, setSearchParams] = useSearchParams()

  const issues = useIssueStore((s) => s.issues)
  const syncing = useIssueStore((s) => s.syncing)
  const syncIssues = useIssueStore((s) => s.syncIssues)
  const tags = useIssueStore((s) => s.tags)
  const tagFilterMode = useIssueStore((s) => s.tagFilterMode)
  const loadTags = useIssueStore((s) => s.loadTags)
  const milestones = useIssueStore((s) => s.milestones)
  const selectedMilestoneId = useIssueStore((s) => s.selectedMilestoneId)
  const loadMilestones = useIssueStore((s) => s.loadMilestones)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const repoName = useRepoStore(selectActiveRepoName)
  const sessions = useSessionStore((s) => s.sessions)
  const navigate = useNavigate()

  const selectedId = searchParams.get("id")
  const tab: DetailTab = searchParams.get("tab") === "pr" ? "pr" : "issue"
  const prNumberParam = searchParams.get("prId")
  const prNumber = prNumberParam ? Number.parseInt(prNumberParam, 10) : null

  // --- URL routing helpers ---

  useEffect(() => {
    const legacy = searchParams.get("issueId")
    if (!legacy) return
    const next = new URLSearchParams(searchParams)
    next.delete("issueId")
    next.set("id", legacy)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const openIssue = useCallback((id: string) => {
    setSearchParams({ id }, { replace: false })
  }, [setSearchParams])

  const closeIssue = useCallback(() => {
    setSearchParams({}, { replace: false })
  }, [setSearchParams])

  const changeTab = useCallback((newTab: DetailTab) => {
    if (!selectedId) return
    const params: Record<string, string> = { id: selectedId }
    if (newTab === "pr") params.tab = "pr"
    setSearchParams(params, { replace: false })
  }, [selectedId, setSearchParams])

  const openPr = useCallback((num: number) => {
    if (!selectedId) return
    setSearchParams({ id: selectedId, tab: "pr", prId: String(num) }, { replace: false })
  }, [selectedId, setSearchParams])

  const backToPrList = useCallback(() => {
    if (!selectedId) return
    setSearchParams({ id: selectedId, tab: "pr" }, { replace: false })
  }, [selectedId, setSearchParams])

  // --- Data loading ---

  useEffect(() => {
    if (activeRepoId) {
      void loadTags()
      void loadMilestones()
    }
  }, [activeRepoId, loadTags, loadMilestones])

  // --- Filtering (delegated to hook) ---

  const {
    childrenMap, issueType, milestoneMap,
    finalFiltered, counts, uniqueAuthors, uniqueAssignees,
  } = useIssueFilters({
    issues, tags, milestones, tagFilterMode,
    stateFilter, typeFilter, searchQuery,
    selectedMilestoneId, selectedAuthor, selectedAssignee,
  })

  // --- Session counts ---

  const sessionCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of sessions) {
      if (s.issueId && !s.parentID) {
        m.set(s.issueId, (m.get(s.issueId) ?? 0) + 1)
      }
    }
    return m
  }, [sessions])

  // --- Selected issue + tree sessions ---

  const selectedIssue = issues.find((i) => i.id === selectedId) ?? null

  const selectedIssueSessions = useMemo(() => {
    if (!selectedId) return []
    const ids = new Set<string>([selectedId])
    if (treeRootId) {
      ids.add(treeRootId)
      const stack = [...(childrenMap.get(treeRootId) ?? [])]
      for (let idx = 0; idx < stack.length; idx++) {
        ids.add(stack[idx].id)
        const grandchildren = childrenMap.get(stack[idx].id)
        if (grandchildren) stack.push(...grandchildren)
      }
    }
    return sessions.filter((s) => s.issueId && ids.has(s.issueId) && !s.parentID)
  }, [selectedId, treeRootId, childrenMap, sessions])

  const handleSessionSelect = useCallback((sessionId: string) => {
    useSessionStore.setState({ activeSessionId: sessionId })
    navigate(`/${encodeURIComponent(repoName!)}/run`)
  }, [navigate, repoName])

  const handleSelectIssue = useCallback((id: string, type: ReturnType<typeof issueType>) => {
    openIssue(id)
    setTreeRootId(type === "epic" ? id : null)
  }, [openIssue])

  // --- Swipe ---

  const swipeHandlers = useSwipeDrawer({
    onSwipeRight: () => setListDrawerOpen(true),
    onSwipeLeft: () => setSidebarOpen(true),
    disabled: !selectedId || listDrawerOpen || sidebarOpen,
  })

  // --- Render ---

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden" {...swipeHandlers}>
      {/* ---- left: issue list ---- */}
      <div
        className={clsx(
          "shrink-0 flex-col bg-surface",
          selectedId
            ? "hidden md:flex md:w-80 border-r border-line"
            : "flex w-full",
        )}
      >
        {!selectedId ? (
          <>
            <IssueFilters
              stateFilter={stateFilter}
              setStateFilter={setStateFilter}
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              expandedFilter={expandedFilter}
              setExpandedFilter={setExpandedFilter}
              selectedAuthor={selectedAuthor}
              setSelectedAuthor={setSelectedAuthor}
              selectedAssignee={selectedAssignee}
              setSelectedAssignee={setSelectedAssignee}
              creating={creating}
              setCreating={setCreating}
              openCount={counts.open}
              closedCount={counts.closed}
              totalCount={issues.length}
              epicCount={counts.epic}
              taskCount={counts.task}
              strayCount={counts.stray}
              afterStateCount={counts.afterState}
              uniqueAuthors={uniqueAuthors}
              uniqueAssignees={uniqueAssignees}
            />
            {creating && <IssueCreateForm onDone={() => setCreating(false)} />}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-line px-3 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">Issues</span>
              {activeRepoId && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void syncIssues()}
                    disabled={syncing}
                    title="同步"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2 disabled:opacity-40"
                  >
                    <RefreshCw className={clsx("h-3.5 w-3.5", syncing && "animate-spin")} />
                  </button>
                </div>
              )}
            </div>
            {creating && <IssueCreateForm onDone={() => setCreating(false)} />}
            <div className="flex border-b border-line">
              {STATE_FILTERS.map(({ key, label }) => {
                const count = key === "open" ? counts.open : key === "closed" ? counts.closed : issues.length
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
                  placeholder="搜索 issue..."
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

        <div className={clsx("flex-1 overflow-y-auto", selectedId ? "px-2 py-2" : "px-3 py-3")}>
          {!activeRepoId ? (
            <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">
              请先选择一个仓库
            </p>
          ) : finalFiltered.length === 0 ? (
            <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">
              {issues.length === 0 ? "点击 ↻ 同步 Issues" : "无匹配 Issue"}
            </p>
          ) : (
            <ul className={clsx(selectedId ? "space-y-0.5" : "space-y-1")}>
              {finalFiltered.map((issue) =>
                selectedId ? (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    sessionCount={sessionCounts.get(issue.id) ?? 0}
                    isActive={selectedId === issue.id}
                    isEpic={issueType(issue) === "epic"}
                    milestone={issue.milestoneId ? milestoneMap.get(issue.milestoneId) : undefined}
                    onSelect={() => handleSelectIssue(issue.id, issueType(issue))}
                  />
                ) : (
                  <FullWidthIssueRow
                    key={issue.id}
                    issue={issue}
                    sessionCount={sessionCounts.get(issue.id) ?? 0}
                    isEpic={issueType(issue) === "epic"}
                    milestone={issue.milestoneId ? milestoneMap.get(issue.milestoneId) : undefined}
                    onSelect={() => handleSelectIssue(issue.id, issueType(issue))}
                  />
                ),
              )}
            </ul>
          )}
        </div>
      </div>

      {selectedId && (
      <SwipeDrawer side="left" open={listDrawerOpen} onClose={() => setListDrawerOpen(false)}>
        <div className="flex h-full flex-col">
          <div className="border-b border-line px-3 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">Issues</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {finalFiltered.length === 0 ? (
              <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">无匹配 Issue</p>
            ) : (
              <ul className="space-y-0.5">
                {finalFiltered.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    sessionCount={sessionCounts.get(issue.id) ?? 0}
                    isActive={selectedId === issue.id}
                    isEpic={issueType(issue) === "epic"}
                    milestone={issue.milestoneId ? milestoneMap.get(issue.milestoneId) : undefined}
                    onSelect={() => {
                      handleSelectIssue(issue.id, issueType(issue))
                      setListDrawerOpen(false)
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </SwipeDrawer>
      )}

      {/* ---- right: detail + overlay sidebar ---- */}
      {selectedId && (
      <div className="relative flex min-w-0 flex-1 flex-col bg-term">
        {selectedIssue ? (
          <>
            <IssueDetailWithTabs
              issue={selectedIssue}
              milestone={selectedIssue.milestoneId ? milestoneMap.get(selectedIssue.milestoneId) : undefined}
              tab={tab}
              prNumber={prNumber}
              onTabChange={changeTab}
              onSelectPr={openPr}
              onBackToPrList={backToPrList}
              onBack={() => { closeIssue(); setTreeRootId(null); setSidebarOpen(false) }}
              onClose={() => { closeIssue(); setTreeRootId(null); setSidebarOpen(false) }}
              onToggleSidebar={() => setSidebarOpen((v) => !v)}
            />

            {/* Sidebar overlay panel */}
            {sidebarOpen && (
              <>
                <div
                  className="absolute inset-0 z-10 bg-black/30"
                  onClick={() => setSidebarOpen(false)}
                />
                <div className="absolute right-0 top-0 bottom-0 z-20 flex w-[280px] flex-col border-l border-line bg-surface shadow-xl">
                  <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-4">
                      {treeRootId ? "子任务树 & 运行记录" : "运行记录"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSidebarOpen(false)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    {treeRootId ? (() => {
                      const rootIssue = issues.find((i) => i.id === treeRootId)
                      if (!rootIssue) return null
                      return (
                        <IssueTreeSidebar
                          rootIssue={rootIssue}
                          childrenMap={childrenMap}
                          currentId={selectedId}
                          onSelect={(id) => { openIssue(id); setSidebarOpen(false) }}
                          sessions={selectedIssueSessions}
                          onSessionSelect={handleSessionSelect}
                        />
                      )
                    })() : (
                      <IssueSessionSidebar
                        sessions={selectedIssueSessions}
                        onSessionSelect={handleSessionSelect}
                      />
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="font-mono text-xs text-fg-5">Issue 未找到</p>
          </div>
        )}
      </div>
      )}
    </div>
  )
}

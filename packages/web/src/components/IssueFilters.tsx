import { ChevronDown, Plus, RefreshCw, Search, X } from "lucide-react"
import clsx from "clsx"
import { useIssueStore } from "../stores/issue-store"
import { useRepoStore } from "../stores/repo-store"

export type StateFilter = "open" | "closed" | "all"
export type TypeFilter = "all" | "epic" | "task" | "stray"
export type ExpandedFilter = "type" | "tag" | "milestone" | "author" | "assignee" | null

export const STATE_FILTERS: { key: StateFilter; label: string }[] = [
  { key: "open", label: "开放" },
  { key: "closed", label: "已关闭" },
  { key: "all", label: "全部" },
]

export function IssueFilters({
  stateFilter,
  setStateFilter,
  typeFilter,
  setTypeFilter,
  searchQuery,
  setSearchQuery,
  expandedFilter,
  setExpandedFilter,
  selectedAuthor,
  setSelectedAuthor,
  selectedAssignee,
  setSelectedAssignee,
  creating,
  setCreating,
  openCount,
  closedCount,
  totalCount,
  epicCount,
  taskCount,
  strayCount,
  afterStateCount,
  uniqueAuthors,
  uniqueAssignees,
}: {
  stateFilter: StateFilter
  setStateFilter: (f: StateFilter) => void
  typeFilter: TypeFilter
  setTypeFilter: (f: TypeFilter) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  expandedFilter: ExpandedFilter
  setExpandedFilter: (f: ExpandedFilter) => void
  selectedAuthor: string | null
  setSelectedAuthor: (a: string | null) => void
  selectedAssignee: string | null
  setSelectedAssignee: (a: string | null) => void
  creating: boolean
  setCreating: (c: boolean) => void
  openCount: number
  closedCount: number
  totalCount: number
  epicCount: number
  taskCount: number
  strayCount: number
  afterStateCount: number
  uniqueAuthors: Array<{ login: string; avatar: string | undefined }>
  uniqueAssignees: Array<{ login: string; avatar: string | undefined }>
}) {
  const syncing = useIssueStore((s) => s.syncing)
  const syncIssues = useIssueStore((s) => s.syncIssues)
  const tags = useIssueStore((s) => s.tags)
  const tagFilterMode = useIssueStore((s) => s.tagFilterMode)
  const cycleTagFilter = useIssueStore((s) => s.cycleTagFilter)
  const clearTagFilter = useIssueStore((s) => s.clearTagFilter)
  const milestones = useIssueStore((s) => s.milestones)
  const selectedMilestoneId = useIssueStore((s) => s.selectedMilestoneId)
  const setMilestoneFilter = useIssueStore((s) => s.setMilestoneFilter)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-line px-4 py-2.5">
        {/* Title */}
        <span className="shrink-0 text-sm font-semibold text-fg md:order-1">Issues</span>
        {/* Sync/Create: right-aligned on mobile, end of row on desktop */}
        {activeRepoId && (
          <div className="ml-auto flex shrink-0 items-center gap-1 md:order-last md:ml-0">
            <button
              type="button"
              onClick={() => void syncIssues()}
              disabled={syncing}
              title="同步 Issues"
              className="flex h-8 w-8 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2 disabled:opacity-40"
            >
              <RefreshCw className={clsx("h-3.5 w-3.5", syncing && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={() => setCreating(!creating)}
              title="新建 Issue"
              className={clsx(
                "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                creating ? "bg-blue-600 text-white" : "text-fg-4 hover:bg-elevated hover:text-fg-2",
              )}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {/* State filters: new row on mobile */}
        <div className="w-full md:order-2 md:w-auto">
          <div className="flex shrink-0 items-center rounded-lg bg-elevated/60 p-0.5">
            {STATE_FILTERS.map(({ key, label }) => {
              const count = key === "open" ? openCount : key === "closed" ? closedCount : totalCount
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
        <div className="w-full md:order-5 md:w-auto md:min-w-0 md:flex-1 md:px-1">
          <div className="flex items-center gap-2 rounded-md border border-line bg-base px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-fg-5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 issue..."
              className="min-w-0 flex-1 bg-transparent text-xs text-fg placeholder:text-fg-6 focus:outline-none"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery("")} className="shrink-0 text-fg-5 hover:text-fg-3">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        {/* Divider: desktop only */}
        <div className="hidden md:order-3 md:mx-1 md:block md:h-4 md:w-px md:shrink-0 md:bg-line" />
        {/* Filter buttons: scrollable row on mobile */}
        <div className="flex w-full gap-2 overflow-x-auto scrollbar-none md:order-4 md:w-auto md:overflow-visible">
          <button
            type="button"
            onClick={() => setExpandedFilter(expandedFilter === "type" ? null : "type")}
            className={clsx(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              expandedFilter === "type" ? "bg-elevated text-fg"
                : typeFilter !== "all" ? "text-fg-2" : "text-fg-4 hover:bg-elevated/60 hover:text-fg-2",
            )}
          >
            类型
            {typeFilter !== "all" && (
              <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">
                {typeFilter === "epic" ? "Epic" : typeFilter === "task" ? "任务" : "游离"}
              </span>
            )}
            <ChevronDown className={clsx("h-3 w-3 transition-transform", expandedFilter === "type" && "rotate-180")} />
          </button>
          <button
            type="button"
            onClick={() => setExpandedFilter(expandedFilter === "tag" ? null : "tag")}
            className={clsx(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              expandedFilter === "tag" ? "bg-elevated text-fg"
                : tagFilterMode.size > 0 ? "text-fg-2" : "text-fg-4 hover:bg-elevated/60 hover:text-fg-2",
            )}
          >
            标签
            {tagFilterMode.size > 0 && (
              <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">
                {tagFilterMode.size}
              </span>
            )}
            <ChevronDown className={clsx("h-3 w-3 transition-transform", expandedFilter === "tag" && "rotate-180")} />
          </button>
          <button
            type="button"
            onClick={() => setExpandedFilter(expandedFilter === "milestone" ? null : "milestone")}
            className={clsx(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              expandedFilter === "milestone" ? "bg-elevated text-fg"
                : selectedMilestoneId ? "text-fg-2" : "text-fg-4 hover:bg-elevated/60 hover:text-fg-2",
            )}
          >
            Milestone
            {selectedMilestoneId && (() => {
              const ms = milestones.find((m) => m.id === selectedMilestoneId)
              return ms ? <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">{ms.title}</span> : null
            })()}
            <ChevronDown className={clsx("h-3 w-3 transition-transform", expandedFilter === "milestone" && "rotate-180")} />
          </button>
          <button
            type="button"
            onClick={() => setExpandedFilter(expandedFilter === "author" ? null : "author")}
            className={clsx(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              expandedFilter === "author" ? "bg-elevated text-fg"
                : selectedAuthor ? "text-fg-2" : "text-fg-4 hover:bg-elevated/60 hover:text-fg-2",
            )}
          >
            Author
            {selectedAuthor && (
              <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">{selectedAuthor}</span>
            )}
            <ChevronDown className={clsx("h-3 w-3 transition-transform", expandedFilter === "author" && "rotate-180")} />
          </button>
          <button
            type="button"
            onClick={() => setExpandedFilter(expandedFilter === "assignee" ? null : "assignee")}
            className={clsx(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              expandedFilter === "assignee" ? "bg-elevated text-fg"
                : selectedAssignee ? "text-fg-2" : "text-fg-4 hover:bg-elevated/60 hover:text-fg-2",
            )}
          >
            Assignee
            {selectedAssignee && (
              <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">{selectedAssignee}</span>
            )}
            <ChevronDown className={clsx("h-3 w-3 transition-transform", expandedFilter === "assignee" && "rotate-180")} />
          </button>
        </div>
      </div>
      {expandedFilter === "type" && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2" style={{ scrollbarWidth: "none" }}>
          {(["epic", "stray", "task", "all"] as const).map((key) => {
            const label = key === "epic" ? "Epic" : key === "stray" ? "游离" : key === "task" ? "任务" : "全部"
            const count = key === "epic" ? epicCount : key === "stray" ? strayCount : key === "task" ? taskCount : afterStateCount
            const active = typeFilter === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTypeFilter(active && key !== "all" ? "all" : key)}
                className={clsx(
                  "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
                  active
                    ? key === "epic" ? "bg-amber-400/15 text-amber-400"
                      : key === "stray" ? "bg-sky-400/15 text-sky-400"
                      : key === "task" ? "bg-violet-400/15 text-violet-400"
                      : "bg-fg-6/20 text-fg-3"
                    : "bg-elevated/60 text-fg-5 hover:bg-elevated hover:text-fg-3",
                )}
              >
                {label}
                <span className={clsx("rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium", active ? "opacity-70" : "text-fg-6")}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {expandedFilter === "tag" && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2" style={{ scrollbarWidth: "none" }}>
          {tags.length === 0 ? (
            <span className="text-xs text-fg-5">暂无标签</span>
          ) : (
            <>
              {tags.map((tag) => {
                const mode = tagFilterMode.get(tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => cycleTagFilter(tag.id)}
                    className={clsx(
                      "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      mode === "include"
                        ? "ring-1 ring-current shadow-sm"
                        : mode === "exclude"
                          ? "opacity-90 line-through decoration-2"
                          : "opacity-50 hover:opacity-80",
                    )}
                    style={mode === "exclude"
                      ? { backgroundColor: `#${tag.color}10`, color: `#${tag.color}`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, #${tag.color} 30%, transparent)` }
                      : { backgroundColor: `#${tag.color}18`, color: `#${tag.color}`, boxShadow: mode === "include" ? `inset 0 0 0 1px color-mix(in srgb, #${tag.color} 50%, transparent)` : undefined }
                    }
                  >
                    {mode === "exclude" && <span className="mr-1 text-[10px]">✕</span>}
                    {tag.name}
                  </button>
                )
              })}
              {tagFilterMode.size > 0 && (
                <button type="button" onClick={clearTagFilter}
                  className="shrink-0 rounded-md px-2 py-1 text-[10px] text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3">
                  清除
                </button>
              )}
            </>
          )}
        </div>
      )}
      {expandedFilter === "milestone" && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2" style={{ scrollbarWidth: "none" }}>
          {milestones.length === 0 ? (
            <span className="text-xs text-fg-5">暂无里程碑</span>
          ) : (
            <>
              {milestones.map((ms) => {
                const active = selectedMilestoneId === ms.id
                return (
                  <button
                    key={ms.id}
                    type="button"
                    onClick={() => setMilestoneFilter(active ? null : ms.id)}
                    className={clsx(
                      "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? "bg-indigo-500/15 text-indigo-400 ring-1 ring-indigo-400/50 shadow-sm"
                        : "bg-elevated/60 text-fg-5 hover:bg-elevated hover:text-fg-3",
                    )}
                  >
                    {ms.title}
                    {ms.state === "closed" && <span className="ml-1 text-[10px] opacity-60">✓</span>}
                  </button>
                )
              })}
              {selectedMilestoneId && (
                <button type="button" onClick={() => setMilestoneFilter(null)}
                  className="shrink-0 rounded-md px-2 py-1 text-[10px] text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3">
                  清除
                </button>
              )}
            </>
          )}
        </div>
      )}
      {expandedFilter === "author" && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2" style={{ scrollbarWidth: "none" }}>
          {uniqueAuthors.length === 0 ? (
            <span className="text-xs text-fg-5">同步后可见作者</span>
          ) : (
            <>
              {uniqueAuthors.map((a) => (
                <button
                  key={a.login}
                  type="button"
                  onClick={() => setSelectedAuthor(selectedAuthor === a.login ? null : a.login)}
                  className={clsx(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    selectedAuthor === a.login
                      ? "bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30 shadow-sm"
                      : "bg-elevated/60 text-fg-5 hover:bg-elevated hover:text-fg-3",
                  )}
                >
                  {a.avatar && <img src={a.avatar} alt="" className="h-4 w-4 rounded-full" />}
                  {a.login}
                </button>
              ))}
              {selectedAuthor && (
                <button type="button" onClick={() => setSelectedAuthor(null)}
                  className="shrink-0 rounded-md px-2 py-1 text-[10px] text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3">
                  清除
                </button>
              )}
            </>
          )}
        </div>
      )}
      {expandedFilter === "assignee" && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2" style={{ scrollbarWidth: "none" }}>
          {uniqueAssignees.length === 0 ? (
            <span className="text-xs text-fg-5">同步后可见指派人</span>
          ) : (
            <>
              {uniqueAssignees.map((a) => (
                <button
                  key={a.login}
                  type="button"
                  onClick={() => setSelectedAssignee(selectedAssignee === a.login ? null : a.login)}
                  className={clsx(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    selectedAssignee === a.login
                      ? "bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30 shadow-sm"
                      : "bg-elevated/60 text-fg-5 hover:bg-elevated hover:text-fg-3",
                  )}
                >
                  {a.avatar && <img src={a.avatar} alt="" className="h-4 w-4 rounded-full" />}
                  {a.login}
                </button>
              ))}
              {selectedAssignee && (
                <button type="button" onClick={() => setSelectedAssignee(null)}
                  className="shrink-0 rounded-md px-2 py-1 text-[10px] text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3">
                  清除
                </button>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}

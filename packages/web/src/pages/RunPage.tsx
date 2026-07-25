import { useRef, useState } from "react"
import { Check, ChevronRight, Copy, Plus, RefreshCw, Search, Trash2, X } from "lucide-react"
import clsx from "clsx"
import type { Session } from "../lib/api-client"
import { useSessionStore } from "../stores/session-store"
import { useRepoStore } from "../stores/repo-store"
import { useIssueStore } from "../stores/issue-store"
import { RunView } from "../components/RunView"

function sessionTime(session: Session): number {
  if (typeof session.time?.updated === "number") return session.time.updated
  if (typeof session.time?.created === "number") return session.time.created
  if (session.createdAt) {
    const parsed = Date.parse(session.createdAt)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

function formatWhen(session: Session): string {
  const raw = sessionTime(session)
  if (!raw) return ""
  const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw
  const date = new Date(ms)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function copyText(text: string) {
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
  } else {
    fallbackCopy(text)
  }
}
function fallbackCopy(text: string) {
  const ta = document.createElement("textarea")
  ta.value = text
  ta.style.cssText = "position:fixed;opacity:0"
  document.body.appendChild(ta)
  ta.select()
  document.execCommand("copy")
  document.body.removeChild(ta)
}

function statusDotClass(status: string | undefined): string {
  switch (status) {
    case "idle": return "bg-emerald-500"
    case "busy": case "retry": return "bg-amber-500 animate-pulse"
    case "error": return "bg-red-500"
    default: return "bg-fg-5"
  }
}

function SessionItem({
  session, isActive, isConfirming,
  onSelect, onDelete, onConfirm, onCancelConfirm,
  status,
}: {
  session: Session; isActive: boolean; isConfirming: boolean
  onSelect: () => void; onDelete: () => void; onConfirm: () => void; onCancelConfirm: () => void
  status: string | undefined
}) {
  const when = formatWhen(session)

  /* ---- iOS-style swipe-to-reveal (mobile) ---- */
  const REVEAL_W = 96
  const [swipeX, setSwipeX] = useState(0)
  const [snap, setSnap] = useState(false)
  const touch = useRef({ x0: 0, y0: 0, base: 0, dir: null as "h" | "v" | null, on: false })

  const onTS = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touch.current = { x0: t.clientX, y0: t.clientY, base: swipeX, dir: null, on: true }
    setSnap(false)
  }
  const onTM = (e: React.TouchEvent) => {
    const c = touch.current
    if (!c.on) return
    const dx = e.touches[0].clientX - c.x0
    const dy = e.touches[0].clientY - c.y0
    if (!c.dir) {
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) c.dir = Math.abs(dx) > Math.abs(dy) ? "h" : "v"
      return
    }
    if (c.dir === "v") return
    setSwipeX(Math.max(-REVEAL_W, Math.min(0, c.base + dx)))
  }
  const onTE = () => {
    touch.current.on = false
    setSnap(true)
    setSwipeX((p) => (p < -REVEAL_W / 2 ? -REVEAL_W : 0))
  }
  const closeSwipe = () => { setSnap(true); setSwipeX(0) }

  return (
    <li className="relative overflow-hidden rounded-md">
      {/* Swipe action buttons (mobile, behind content) */}
      <div
        className="absolute right-0 top-0 bottom-0 flex md:hidden"
        style={swipeX < 0 ? { zIndex: 10 } : undefined}
      >
        {isConfirming ? (
          <>
            <button type="button" onClick={() => { onDelete(); closeSwipe() }} className="flex w-12 items-center justify-center bg-red-500 text-white active:bg-red-600">
              <Check className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => { onCancelConfirm(); closeSwipe() }} className="flex w-12 items-center justify-center bg-neutral-500 text-white active:bg-neutral-600">
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                copyText(JSON.stringify({ id: session.id, name: session.title?.trim() || "" }, null, 2))
                closeSwipe()
              }}
              className="flex w-12 items-center justify-center bg-blue-500 text-white active:bg-blue-600"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => onConfirm()} className="flex w-12 items-center justify-center bg-red-500 text-white active:bg-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* Slideable content */}
      <div
        className={clsx(
          "group relative rounded-md border-l-2",
          isActive ? "border-blue-500 bg-elevated" : "border-transparent bg-surface hover:bg-elevated/50",
          snap && "transition-transform duration-200 ease-out",
        )}
        style={{
          ...(swipeX !== 0 ? { transform: `translateX(${swipeX}px)` } : {}),
          ...(swipeX === -REVEAL_W ? { pointerEvents: "none" as const } : {}),
        }}
        onTouchStart={onTS}
        onTouchMove={onTM}
        onTouchEnd={onTE}
      >
        <button
          type="button"
          onClick={() => { onSelect(); closeSwipe() }}
          className="block w-full px-2.5 py-2 text-left"
          style={swipeX === -REVEAL_W ? { pointerEvents: "auto" } : undefined}
        >
          <div className="flex items-center gap-2">
            <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(status))} />
            <span className="min-w-0 truncate font-mono text-xs text-fg-3">{session.agent?.trim() || "默认"}</span>
            {when && <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-fg-5">{when}</span>}
          </div>
          <div className="mt-0.5 truncate pl-3.5 text-sm text-fg-2">{session.title?.trim() || "未命名运行"}</div>
        </button>

        {/* Desktop hover buttons */}
        {isConfirming ? (
          <span className="absolute right-1.5 top-1.5 hidden items-center gap-1 rounded bg-surface/90 px-0.5 md:flex">
            <button type="button" onClick={onDelete} className="rounded p-1 text-red-400 hover:bg-red-500/10"><Check className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={onCancelConfirm} className="rounded p-1 text-fg-3 hover:bg-elevated"><X className="h-3.5 w-3.5" /></button>
          </span>
        ) : (
          <span className="absolute right-1.5 top-1.5 hidden items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 md:flex">
            <button
              type="button"
              onClick={() => {
                copyText(JSON.stringify({ id: session.id, name: session.title?.trim() || "" }, null, 2))
              }}
              title="复制 Session JSON"
              className="rounded p-1 text-fg-5 hover:text-fg-2"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onConfirm} className="rounded p-1 text-fg-5 hover:text-red-400">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
    </li>
  )
}

function IssueRow({ issue, indent, selected, badge, onClick }: {
  issue: { id: string; number: number; title: string; state: string }
  indent?: boolean; selected?: boolean; badge?: number; onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          "group flex w-full items-center gap-2 rounded-md py-1.5 text-left transition-colors",
          indent ? "pl-6 pr-2.5" : "px-2.5",
          selected ? "bg-blue-500/10" : "hover:bg-elevated/50",
        )}
      >
        <span className={clsx(
          "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium",
          issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
        )}>
          #{issue.number}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-fg-3">{issue.title}</span>
        {badge != null && badge > 0 && (
          <span className="shrink-0 rounded-full bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">{badge}</span>
        )}
      </button>
    </li>
  )
}

function SessionPanel({ onClose }: { onClose?: () => void }) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const statuses = useSessionStore((s) => s.sessionStatuses)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const issues = useIssueStore((s) => s.issues)
  const syncing = useIssueStore((s) => s.syncing)
  const syncIssues = useIssueStore((s) => s.syncIssues)
  const matchingParentId = useIssueStore((s) => s.matchingParentId)
  const matchingCandidateId = useIssueStore((s) => s.matchingCandidateId)

  const topLevel = [...sessions]
    .filter((s) => !s.parentID)
    .sort((a, b) => sessionTime(b) - sessionTime(a))

  const issueMap = new Map(issues.map((i) => [i.id, i]))
  const sessionsByIssue = new Map<string, Session[]>()
  const unlinked: Session[] = []

  for (const s of topLevel) {
    if (s.issueId && issueMap.has(s.issueId)) {
      const issue = issueMap.get(s.issueId)!
      if (issue.state === "closed") continue
      const list = sessionsByIssue.get(s.issueId) ?? []
      list.push(s)
      sessionsByIssue.set(s.issueId, list)
    } else {
      unlinked.push(s)
    }
  }

  const openIssues = issues.filter((i) => i.state === "open")
  const childrenOf = new Map<string, typeof openIssues>()
  const rootIssues = openIssues.filter((i) => {
    if (i.parentId) {
      const list = childrenOf.get(i.parentId) ?? []
      list.push(i)
      childrenOf.set(i.parentId, list)
      return false
    }
    return true
  })

  const epics = rootIssues.filter((i) => childrenOf.has(i.id))
  const strayIssues = rootIssues.filter((i) => !childrenOf.has(i.id))

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const renderSessionList = (list: Session[]) => (
    <ul className="space-y-0.5">
      {list.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          isConfirming={confirmingId === session.id}
          status={statuses.get(session.id)}
          onSelect={() => { void setActiveSession(session.id); onClose?.() }}
          onDelete={() => { void deleteSession(session.id); setConfirmingId(null) }}
          onConfirm={() => setConfirmingId(session.id)}
          onCancelConfirm={() => setConfirmingId(null)}
        />
      ))}
    </ul>
  )

  const handleIssueClick = (issueId: string) => {
    if (matchingParentId) {
      useIssueStore.getState().setMatchCandidate(issueId)
    } else {
      useIssueStore.getState().setPreviewIssue(issueId)
      useSessionStore.setState({ activeSessionId: null })
    }
    onClose?.()
  }

  if (matchingParentId) {
    const parent = issueMap.get(matchingParentId)
    const q = search.toLowerCase()
    const filtered = issues.filter((i) =>
      i.id !== matchingParentId && (!q || `#${i.number} ${i.title}`.toLowerCase().includes(q))
    )

    return (
      <div className="flex h-full w-80 shrink-0 flex-col border-r border-line bg-surface">
        <div className="border-b border-line px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">选择子任务</span>
          {parent && <p className="mt-0.5 truncate font-mono text-[10px] text-fg-5">父: #{parent.number} {parent.title}</p>}
        </div>
        <div className="border-b border-line px-3 py-2">
          <div className="flex items-center gap-2 rounded-md border border-line bg-base px-2 py-1">
            <Search className="h-3.5 w-3.5 text-fg-5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 issue..."
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-fg placeholder:text-fg-6 focus:outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <ul className="space-y-0.5">
            {filtered.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                selected={issue.id === matchingCandidateId}
                onClick={() => handleIssueClick(issue.id)}
              />
            ))}
          </ul>
          {filtered.length === 0 && (
            <p className="px-2 py-4 text-center font-mono text-xs text-fg-5">无匹配结果</p>
          )}
        </div>
      </div>
    )
  }

  const hasIssueGroups = sessionsByIssue.size > 0

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-line px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">运行记录</span>
          {activeRepoId && (
            <button
              type="button"
              onClick={() => { useSessionStore.setState({ activeSessionId: null }); onClose?.() }}
              title="新建运行"
              className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-white transition-colors hover:bg-blue-500"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {!activeRepoId ? (
            <p className="px-2 py-6 text-center font-mono text-xs text-fg-5">请先选择一个仓库</p>
          ) : topLevel.length === 0 ? (
            <p className="px-2 py-6 text-center font-mono text-xs text-fg-5">暂无运行记录</p>
          ) : (
            <div className="space-y-3">
              {[...sessionsByIssue.entries()].map(([gid, list]) => {
                const issue = issueMap.get(gid)!
                return (
                  <div key={gid}>
                    <div className="mb-1 flex items-center gap-1.5 px-1">
                      <span className={clsx(
                        "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium",
                        issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
                      )}>
                        #{issue.number}
                      </span>
                      <span className="min-w-0 truncate text-xs font-medium text-fg-3">{issue.title}</span>
                    </div>
                    {renderSessionList(list)}
                  </div>
                )
              })}
              {unlinked.length > 0 && (
                <div>
                  {hasIssueGroups && (
                    <div className="mb-1 px-1">
                      <span className="text-xs font-medium text-fg-5">未关联 Issue</span>
                    </div>
                  )}
                  {renderSessionList(unlinked)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-line">
        <div className="flex items-center justify-between border-b border-line px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">Issues</span>
          {activeRepoId && (
            <button
              type="button"
              onClick={() => void syncIssues()}
              disabled={syncing}
              title="同步 Issues"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2 disabled:opacity-40"
            >
              <RefreshCw className={clsx("h-3.5 w-3.5", syncing && "animate-spin")} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {!activeRepoId ? (
            <p className="px-2 py-4 text-center font-mono text-xs text-fg-5">请先选择一个仓库</p>
          ) : issues.length === 0 ? (
            <p className="px-2 py-4 text-center font-mono text-xs text-fg-5">点击 ↻ 同步 Issues</p>
          ) : (
            <ul className="space-y-0.5">
              {epics.map((issue) => {
                const children = childrenOf.get(issue.id) ?? []
                const isExpanded = expanded.has(issue.id)
                return (
                  <li key={issue.id}>
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => toggleExpand(issue.id)}
                        className="flex h-6 w-5 shrink-0 items-center justify-center text-fg-5"
                      >
                        <ChevronRight className={clsx("h-3 w-3 transition-transform", isExpanded && "rotate-90")} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleIssueClick(issue.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2.5 text-left transition-colors hover:bg-elevated/50"
                      >
                        <span className={clsx(
                          "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                          issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
                        )}>
                          #{issue.number}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg-2">{issue.title}</span>
                        <span className="shrink-0 rounded-full bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">{children.length}</span>
                      </button>
                    </div>
                    {isExpanded && (
                      <ul className="space-y-0.5">
                        {children.map((child) => (
                          <IssueRow key={child.id} issue={child} indent onClick={() => handleIssueClick(child.id)} />
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
              {strayIssues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  badge={sessionsByIssue.get(issue.id)?.length}
                  onClick={() => handleIssueClick(issue.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export function RunPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  return (
    <div className="flex min-h-0 flex-1">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        className={clsx(
          "fixed bottom-0 left-0 top-0 z-50 flex shrink-0 pt-[var(--safe-top)] pb-[var(--safe-bottom)] transition-transform md:static md:z-auto md:translate-x-0 md:pt-0 md:pb-0 md:transition-none",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <SessionPanel onClose={() => setSidebarOpen(false)} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <RunView onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      </div>
    </div>
  )
}

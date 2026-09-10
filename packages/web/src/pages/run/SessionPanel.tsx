import { useState } from "react"
import { Plus, Search, X } from "lucide-react"
import clsx from "clsx"
import type { Session } from "../../lib/api-client"
import { useSessionStore, EMPTY_TODOS } from "../../stores/session-store"
import { useRepoStore } from "../../stores/repo-store"
import { useIssueStore } from "../../stores/issue-store"
import { SessionItem } from "./SessionItem"
import { sessionTime, SWIPE_HINT_KEY } from "./run-page-utils"

export function SessionPanel({ onClose }: { onClose?: () => void }) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [showPeekHint] = useState(() => {
    if (typeof window === "undefined") return false
    if (localStorage.getItem(SWIPE_HINT_KEY)) return false
    localStorage.setItem(SWIPE_HINT_KEY, "1")
    return true
  })

  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const statuses = useSessionStore((s) => s.sessionStatuses)
  const sessionFilter = useSessionStore((s) => s.sessionFilter)
  const setSessionFilter = useSessionStore((s) => s.setSessionFilter)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const toggleSessionComplete = useSessionStore((s) => s.toggleSessionComplete)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const issues = useIssueStore((s) => s.issues)
  const allSessionLinks = useSessionStore((s) => s.allSessionLinks)
  const allTodos = useSessionStore((s) => s.todos)
  const sessionSearch = useSessionStore((s) => s.sessionSearch)
  const setSessionSearch = useSessionStore((s) => s.setSessionSearch)
  const toggleSessionPin = useSessionStore((s) => s.toggleSessionPin)

  const searchTerm = sessionSearch.toLowerCase()
  const topLevel = [...sessions]
    .filter((s) => {
      if (s.parentID) return false
      if (sessionFilter === "active") return !s.completedAt
      return true
    })
    .filter((s) => {
      if (!searchTerm) return true
      const title = (s.title ?? "").toLowerCase()
      const agent = (s.agent ?? "").toLowerCase()
      return title.includes(searchTerm) || agent.includes(searchTerm)
    })
    .sort((a, b) => {
      const pa = a.pinnedAt
      const pb = b.pinnedAt
      if (pa && !pb) return -1
      if (!pa && pb) return 1
      if (pa && pb) return pb - pa
      return sessionTime(b) - sessionTime(a)
    })

  const issueMap = new Map(issues.map((i) => [i.id, i]))
  const renderSessionList = (list: Session[]) => (
    <ul className="space-y-0.5">
      {list.map((session, idx) => {
        const linkedIssue = session.issueId ? issueMap.get(session.issueId) : undefined
        const sLinks = allSessionLinks[session.id]
        const linkedItems: Array<{ number: number; state: string; type: "issue" | "pr"; mergedAt?: number | null }> = []
        if (sLinks) {
          for (const i of sLinks.issues) linkedItems.push({ number: i.number, state: i.state, type: "issue" })
          for (const p of sLinks.pullRequests) linkedItems.push({ number: p.number, state: p.state, type: "pr", mergedAt: p.mergedAt })
        }
        return (
          <SessionItem
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            isConfirming={confirmingId === session.id}
            peekHint={showPeekHint && idx === 0}
            status={statuses[session.id]}
            issue={linkedIssue ? { number: linkedIssue.number, title: linkedIssue.title, state: linkedIssue.state } : undefined}
            linkedItems={linkedItems.length > 0 ? linkedItems : undefined}
            onSelect={() => { void setActiveSession(session.id); onClose?.() }}
            onDelete={() => { void deleteSession(session.id); setConfirmingId(null) }}
            onConfirm={() => setConfirmingId(session.id)}
            onCancelConfirm={() => setConfirmingId(null)}
            onRename={(title) => void renameSession(session.id, title)}
            onToggleComplete={() => void toggleSessionComplete(session.id)}
            onTogglePin={() => void toggleSessionPin(session.id)}
            todos={allTodos[session.id] ?? EMPTY_TODOS}
          />
        )
      })}
    </ul>
  )

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
        {activeRepoId && (
          <div className="hidden border-b border-line px-3 py-1.5 md:block">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-5" />
              <input
                type="text"
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                placeholder="搜索运行记录..."
                className="w-full rounded-md border border-line bg-base py-1 pl-7 pr-7 text-xs text-fg-2 placeholder:text-fg-5 outline-none focus:border-blue-500"
              />
              {sessionSearch && (
                <button
                  type="button"
                  onClick={() => setSessionSearch("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-5 hover:text-fg-3"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}
        {activeRepoId && (
          <div className="flex gap-1 border-b border-line px-3 py-1.5">
            {([["active", "进行中"], ["all", "全部"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSessionFilter(key)}
                className={clsx(
                  "rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors",
                  sessionFilter === key ? "bg-elevated text-fg-2" : "text-fg-5 hover:text-fg-3",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {!activeRepoId ? (
            <p className="px-2 py-6 text-center font-mono text-xs text-fg-5">请先选择一个仓库</p>
          ) : topLevel.length === 0 ? (
            <p className="px-2 py-6 text-center font-mono text-xs text-fg-5">暂无运行记录</p>
          ) : (
            <div>
              {renderSessionList(topLevel)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

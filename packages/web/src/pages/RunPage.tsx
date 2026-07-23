import { useState } from "react"
import { Check, Copy, Plus, RefreshCw, Trash2, X } from "lucide-react"
import clsx from "clsx"
import type { Session } from "../lib/api-client"
import { useSessionStore } from "../stores/session-store"
import { useRepoStore } from "../stores/repo-store"
import { useIssueStore } from "../stores/issue-store"
import { RunView } from "../components/RunView"

function sessionTime(session: Session): number {
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
  return (
    <li>
      <div className={clsx(
        "group relative rounded-md border-l-2 transition-colors",
        isActive ? "border-blue-500 bg-elevated/80" : "border-transparent hover:bg-elevated/50",
      )}>
        <button type="button" onClick={onSelect} className="block w-full px-2.5 py-2 text-left">
          <div className="flex items-center gap-2">
            <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(status))} />
            <span className="min-w-0 truncate font-mono text-xs text-fg-3">{session.agent?.trim() || "默认"}</span>
            {when && <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-fg-5">{when}</span>}
          </div>
          <div className="mt-0.5 truncate pl-3.5 text-sm text-fg-2">{session.title?.trim() || "未命名运行"}</div>
        </button>
        {isConfirming ? (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-surface/90 px-0.5">
            <button type="button" onClick={onDelete} className="rounded p-1 text-red-400 hover:bg-red-500/10"><Check className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={onCancelConfirm} className="rounded p-1 text-fg-3 hover:bg-elevated"><X className="h-3.5 w-3.5" /></button>
          </span>
        ) : (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => {
                const json = JSON.stringify({ id: session.id, name: session.title?.trim() || "" }, null, 2)
                void navigator.clipboard.writeText(json)
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

function SessionPanel() {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const statuses = useSessionStore((s) => s.sessionStatuses)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const issues = useIssueStore((s) => s.issues)
  const syncing = useIssueStore((s) => s.syncing)
  const syncIssues = useIssueStore((s) => s.syncIssues)

  const topLevel = [...sessions]
    .filter((s) => !s.parentID)
    .sort((a, b) => sessionTime(b) - sessionTime(a))

  const issueMap = new Map(issues.map((i) => [i.id, i]))
  const grouped = new Map<string, Session[]>()
  const unlinked: Session[] = []

  for (const s of topLevel) {
    if (s.issueId && issueMap.has(s.issueId)) {
      const list = grouped.get(s.issueId) ?? []
      list.push(s)
      grouped.set(s.issueId, list)
    } else {
      unlinked.push(s)
    }
  }

  const renderList = (list: Session[]) => (
    <ul className="space-y-0.5">
      {list.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          isConfirming={confirmingId === session.id}
          status={statuses.get(session.id)}
          onSelect={() => void setActiveSession(session.id)}
          onDelete={() => { void deleteSession(session.id); setConfirmingId(null) }}
          onConfirm={() => setConfirmingId(session.id)}
          onCancelConfirm={() => setConfirmingId(null)}
        />
      ))}
    </ul>
  )

  const hasIssueGroups = grouped.size > 0

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-line bg-surface">
      {/* ---- upper half: sessions ---- */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-line px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">运行记录</span>
          {activeRepoId && (
            <button
              type="button"
              onClick={() => useSessionStore.setState({ activeSessionId: null })}
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
              {[...grouped.entries()].map(([gid, list]) => {
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
                    {renderList(list)}
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
                  {renderList(unlinked)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- lower half: issues ---- */}
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
              {issues.map((issue) => {
                const count = grouped.get(issue.id)?.length ?? 0
                return (
                  <li key={issue.id}>
                    <button
                      type="button"
                      onClick={() => {
                        useIssueStore.getState().setPreviewIssue(issue.id)
                        useSessionStore.setState({ activeSessionId: null })
                      }}
                      className="group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-elevated/50"
                    >
                      <span className={clsx(
                        "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium",
                        issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
                      )}>
                        #{issue.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-fg-3">{issue.title}</span>
                      {count > 0 && (
                        <span className="shrink-0 rounded-full bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">{count}</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export function RunPage() {
  return (
    <div className="flex min-h-0 flex-1">
      <SessionPanel />
      <div className="flex min-w-0 flex-1 flex-col">
        <RunView />
      </div>
    </div>
  )
}

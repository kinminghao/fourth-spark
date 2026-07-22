import { useState } from "react"
import { Check, Plus, Trash2, X } from "lucide-react"
import clsx from "clsx"
import type { Session } from "../lib/api-client"
import { useSessionStore } from "../stores/session-store"
import { useAgentStore } from "../stores/agent-store"
import { useRepoStore } from "../stores/repo-store"
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

function SessionPanel() {
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState("")
  const [agent, setAgent] = useState("")
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const statuses = useSessionStore((s) => s.sessionStatuses)
  const createSession = useSessionStore((s) => s.createSession)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const agents = useAgentStore((s) => s.agents)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)

  const ordered = [...sessions]
    .filter((s) => !s.parentID)
    .sort((a, b) => sessionTime(b) - sessionTime(a))

  const handleCreate = async () => {
    const text = draft.trim()
    if (!text) return
    setDraft("")
    setShowForm(false)
    await createSession(text, agent || undefined)
  }

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">运行记录</span>
        {activeRepoId && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            title="新建运行"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-white transition-colors hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {showForm && activeRepoId && (
        <div className="flex flex-col gap-2 border-b border-line bg-base/60 p-3">
          {agents.length > 0 && (
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg focus:border-blue-500 focus:outline-none"
            >
              <option value="">默认 Agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          <textarea
            value={draft}
            rows={3}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            placeholder="让 Agent 做什么？"
            className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg placeholder:text-fg-5 focus:border-blue-500 focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowForm(false); setDraft("") }} className="rounded-md px-3 py-1.5 text-xs text-fg-3 hover:bg-elevated hover:text-fg">
              取消
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={draft.trim().length === 0}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-fg-6 disabled:text-fg-4"
            >
              开始运行
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {!activeRepoId ? (
          <p className="px-2 py-6 text-center font-mono text-xs text-fg-5">请先选择一个仓库</p>
        ) : ordered.length === 0 ? (
          <p className="px-2 py-6 text-center font-mono text-xs text-fg-5">暂无运行记录，点击上方开始</p>
        ) : (
          <ul className="space-y-0.5">
            {ordered.map((session) => {
              const isActive = session.id === activeSessionId
              const isConfirming = confirmingId === session.id
              const when = formatWhen(session)
              return (
                <li key={session.id}>
                  <div className={clsx(
                    "group relative rounded-md border-l-2 transition-colors",
                    isActive ? "border-blue-500 bg-elevated/80" : "border-transparent hover:bg-elevated/50",
                  )}>
                    <button type="button" onClick={() => void setActiveSession(session.id)} className="block w-full px-2.5 py-2 text-left">
                      <div className="flex items-center gap-2">
                        <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(statuses.get(session.id)))} />
                        <span className="min-w-0 truncate font-mono text-xs text-fg-3">{session.agent?.trim() || "默认"}</span>
                        {when && <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-fg-5">{when}</span>}
                      </div>
                      <div className="mt-0.5 truncate pl-3.5 text-sm text-fg-2">{session.title?.trim() || "未命名运行"}</div>
                    </button>
                    {isConfirming ? (
                      <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-surface/90 px-0.5">
                        <button type="button" onClick={() => { void deleteSession(session.id); setConfirmingId(null) }} className="rounded p-1 text-red-400 hover:bg-red-500/10"><Check className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => setConfirmingId(null)} className="rounded p-1 text-fg-3 hover:bg-elevated"><X className="h-3.5 w-3.5" /></button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmingId(session.id)} className="absolute right-1.5 top-1.5 rounded p-1 text-fg-5 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
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

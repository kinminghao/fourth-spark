import { useState } from "react"
import { Check, Plus, Sparkles, Trash2, X } from "lucide-react"
import clsx from "clsx"
import type { Session } from "../lib/api-client"
import { useSessionStore } from "../stores/session-store"
import { useAgentStore } from "../stores/agent-store"

function sessionTime(session: Session): number {
  if (typeof session.time?.created === "number") {
    return session.time.created
  }
  if (session.createdAt) {
    const parsed = Date.parse(session.createdAt)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

function statusDotClass(status: string | undefined): string {
  switch (status) {
    case "idle":
      return "bg-emerald-500"
    case "busy":
      return "bg-amber-500 animate-pulse"
    case "retry":
      return "bg-amber-500 animate-pulse"
    case "error":
      return "bg-red-500"
    default:
      return "bg-zinc-600"
  }
}

export function SessionList({ onNavigate }: { onNavigate?: () => void }) {
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState("")
  const [agent, setAgent] = useState("")
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const sessions = useSessionStore((state) => state.sessions)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const statuses = useSessionStore((state) => state.sessionStatuses)
  const createSession = useSessionStore((state) => state.createSession)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const deleteSession = useSessionStore((state) => state.deleteSession)
  const agents = useAgentStore((state) => state.agents)

  const ordered = [...sessions].sort((a, b) => sessionTime(b) - sessionTime(a))

  const handleCreate = async () => {
    const text = draft.trim()
    if (!text) {
      return
    }
    setDraft("")
    setShowForm(false)
    await createSession(text, agent || undefined)
    onNavigate?.()
  }

  const handleSelect = (id: string) => {
    void setActiveSession(id)
    onNavigate?.()
  }

  return (
    <div className="flex h-full flex-col bg-zinc-900">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-400" />
          <h1 className="text-sm font-semibold text-zinc-100">Fourth Spark</h1>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((value) => !value)}
          aria-label="New session"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {showForm && (
        <div className="flex flex-col gap-2 border-b border-zinc-800 bg-zinc-950/50 p-3">
          {agents.length > 0 && (
            <select
              value={agent}
              onChange={(event) => setAgent(event.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Default agent</option>
              {agents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
          <textarea
            value={draft}
            rows={3}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            placeholder="What should the agent work on?"
            className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setDraft("")
              }}
              className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={draft.trim().length === 0}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {ordered.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-zinc-600">
            No sessions yet. Create one to get started.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {ordered.map((session) => {
              const isActive = session.id === activeSessionId
              const isConfirming = confirmingId === session.id
              return (
                <li key={session.id}>
                  <div
                    className={clsx(
                      "group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors",
                      isActive ? "bg-zinc-800" : "hover:bg-zinc-800/60",
                    )}
                  >
                    <span
                      className={clsx(
                        "h-2 w-2 shrink-0 rounded-full",
                        statusDotClass(statuses.get(session.id)),
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => handleSelect(session.id)}
                      className="min-w-0 flex-1 truncate text-left text-sm text-zinc-200"
                    >
                      {session.title?.trim() || "Untitled session"}
                    </button>
                    {isConfirming ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            void deleteSession(session.id)
                            setConfirmingId(null)
                          }}
                          aria-label="Confirm delete"
                          className="rounded p-1 text-red-400 hover:bg-red-500/10"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          aria-label="Cancel delete"
                          className="rounded p-1 text-zinc-400 hover:bg-zinc-700"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingId(session.id)}
                        aria-label="Delete session"
                        className="shrink-0 rounded p-1 text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                      >
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

import { useState } from "react"
import { Check, Monitor, Moon, Plus, Sun, Terminal, Trash2, X } from "lucide-react"
import clsx from "clsx"
import type { Session } from "../lib/api-client"
import { useSessionStore } from "../stores/session-store"
import { useAgentStore } from "../stores/agent-store"
import { useThemeStore } from "../stores/theme-store"

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

function formatWhen(session: Session): string {
  const raw = sessionTime(session)
  if (!raw) {
    return ""
  }
  const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw
  const date = new Date(ms)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function statusDotClass(status: string | undefined): string {
  switch (status) {
    case "idle":
      return "bg-emerald-500"
    case "busy":
    case "retry":
      return "bg-amber-500 animate-pulse"
    case "error":
      return "bg-red-500"
    default:
      return "bg-fg-5"
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

  const ordered = [...sessions]
    .filter((s) => !s.parentID)
    .sort((a, b) => sessionTime(b) - sessionTime(a))

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

  const preference = useThemeStore((state) => state.preference)
  const cycle = useThemeStore((state) => state.cycle)

  const ThemeIcon = preference === "light" ? Sun : preference === "dark" ? Moon : Monitor

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-emerald-400" />
          <h1 className="text-sm font-semibold tracking-tight text-fg">
            Fourth Spark
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={cycle}
            aria-label={`Theme: ${preference}`}
            title={`Theme: ${preference}`}
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
          >
            <ThemeIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            aria-label="New run"
            title="New run"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-white transition-colors hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showForm && (
        <div className="flex flex-col gap-2 border-b border-line bg-base/60 p-3">
          {agents.length > 0 && (
            <select
              value={agent}
              onChange={(event) => setAgent(event.target.value)}
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg focus:border-emerald-500 focus:outline-none"
            >
              <option value="">default agent</option>
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
            placeholder="what should the agent work on?"
            className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg placeholder:text-fg-5 focus:border-emerald-500 focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setDraft("")
              }}
              className="rounded-md px-3 py-1.5 text-xs text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={draft.trim().length === 0}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6 disabled:text-fg-4"
            >
              Start run
            </button>
          </div>
        </div>
      )}

      <div className="px-3 pb-1 pt-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-fg-5">
          Runs
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {ordered.length === 0 ? (
          <p className="px-2 py-6 text-center font-mono text-xs text-fg-5">
            no runs yet. start one above.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {ordered.map((session) => {
              const isActive = session.id === activeSessionId
              const isConfirming = confirmingId === session.id
              const when = formatWhen(session)
              return (
                <li key={session.id}>
                  <div
                    className={clsx(
                      "group relative rounded-md border-l-2 transition-colors",
                      isActive
                        ? "border-emerald-500 bg-elevated/80"
                        : "border-transparent hover:bg-elevated/50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(session.id)}
                      className="block w-full px-2.5 py-2 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={clsx(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            statusDotClass(statuses.get(session.id)),
                          )}
                        />
                        <span className="min-w-0 truncate font-mono text-xs text-fg-3">
                          {session.agent?.trim() || "default"}
                        </span>
                        {when && (
                          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-fg-5">
                            {when}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate pl-3.5 text-sm text-fg-2">
                        {session.title?.trim() || "untitled run"}
                      </div>
                    </button>
                    {isConfirming ? (
                      <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-surface/90 px-0.5">
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
                          className="rounded p-1 text-fg-3 hover:bg-elevated"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingId(session.id)}
                        aria-label="Delete run"
                        className="absolute right-1.5 top-1.5 rounded p-1 text-fg-5 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
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

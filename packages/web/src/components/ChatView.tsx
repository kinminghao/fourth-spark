import { useEffect, useRef } from "react"
import { AlertTriangle, Menu, Sparkles, Square } from "lucide-react"
import clsx from "clsx"
import {
  EMPTY_MESSAGES,
  EMPTY_TODOS,
  useSessionStore,
} from "../stores/session-store"
import { useSessionEvents } from "../hooks/use-session-events"
import { MessageBubble } from "./MessageBubble"
import { TodoProgress } from "./TodoProgress"
import { InputBar } from "./InputBar"

function StatusBadge({ status }: { status: string | undefined }) {
  const config: Record<string, { label: string; dot: string; text: string }> = {
    idle: { label: "Idle", dot: "bg-emerald-500", text: "text-emerald-400" },
    busy: { label: "Working", dot: "bg-amber-500", text: "text-amber-400" },
    retry: { label: "Retrying", dot: "bg-amber-500", text: "text-amber-400" },
    error: { label: "Error", dot: "bg-red-500", text: "text-red-400" },
  }
  const entry = config[status ?? "idle"] ?? config.idle
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-zinc-800 px-2 py-0.5 text-xs">
      <span
        className={clsx(
          "h-1.5 w-1.5 rounded-full",
          entry.dot,
          status === "busy" && "animate-pulse",
        )}
      />
      <span className={entry.text}>{entry.label}</span>
    </span>
  )
}

export function ChatView({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const session = useSessionStore(
    (state) =>
      state.sessions.find((item) => item.id === state.activeSessionId) ?? null,
  )
  const messages = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? (state.messages.get(id) ?? EMPTY_MESSAGES) : EMPTY_MESSAGES
  })
  const todos = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? (state.todos.get(id) ?? EMPTY_TODOS) : EMPTY_TODOS
  })
  const status = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? state.sessionStatuses.get(id) : undefined
  })
  const sendError = useSessionStore((state) => state.sendError)
  const abortSession = useSessionStore((state) => state.abortSession)

  useSessionEvents(activeSessionId)

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = scrollRef.current
    if (element) {
      element.scrollTop = element.scrollHeight
    }
  }, [messages, todos])

  if (!activeSessionId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-950 text-center">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Open sidebar"
          className="absolute left-3 top-3 rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Sparkles className="h-10 w-10 text-zinc-700" />
        <p className="text-sm text-zinc-500">Select or create a session</p>
      </div>
    )
  }

  const busy = status === "busy"

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-zinc-950">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Open sidebar"
          className="-ml-1 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-zinc-100">
            {session?.title?.trim() || "Untitled session"}
          </h2>
          {session?.agent && (
            <p className="truncate text-xs text-zinc-500">{session.agent}</p>
          )}
        </div>
        <StatusBadge status={status} />
        {busy && (
          <button
            type="button"
            onClick={() => void abortSession()}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-red-500/50 hover:text-red-400"
          >
            <Square className="h-3 w-3 fill-current" />
            Stop
          </button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
          {messages.length === 0 ? (
            <p className="py-10 text-center text-xs text-zinc-600">
              No messages yet.
            </p>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))
          )}
          {todos.length > 0 && <TodoProgress todos={[...todos]} />}
        </div>
      </div>

      {sendError && (
        <div className="flex items-center gap-2 border-t border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{sendError}</span>
        </div>
      )}

      <InputBar />
    </div>
  )
}

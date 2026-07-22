import { Fragment, useEffect, useRef } from "react"
import { AlertTriangle, Menu, Square } from "lucide-react"
import clsx from "clsx"
import {
  EMPTY_MESSAGES,
  EMPTY_TODOS,
  useSessionStore,
} from "../stores/session-store"
import { useSessionEvents } from "../hooks/use-session-events"
import { ExecutionBlock } from "./ExecutionBlock"
import { TodoProgress } from "./TodoProgress"
import { InputBar } from "./InputBar"

const STATUS_META: Record<
  string,
  { glyph: string; label: string; color: string; spin: boolean }
> = {
  idle: { glyph: "●", label: "ready", color: "text-emerald-400", spin: false },
  busy: { glyph: "◌", label: "running", color: "text-amber-400", spin: true },
  retry: { glyph: "◌", label: "retrying", color: "text-amber-400", spin: true },
  error: { glyph: "✗", label: "error", color: "text-red-400", spin: false },
}

function StatusBadge({ status }: { status: string | undefined }) {
  const meta = STATUS_META[status ?? "idle"] ?? STATUS_META.idle
  return (
    <span
      className={clsx(
        "flex items-center gap-1.5 rounded border border-line px-2 py-0.5 font-mono text-xs",
        meta.color,
      )}
    >
      <span className={clsx("leading-none", meta.spin && "fs-spin")}>
        {meta.glyph}
      </span>
      <span>{meta.label}</span>
    </span>
  )
}

export function RunView({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
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
      <div className="relative flex flex-1 flex-col items-center justify-center gap-3 bg-term text-center">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Open sidebar"
          className="absolute left-3 top-3 rounded-lg p-2 text-fg-3 hover:bg-elevated md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="font-mono text-2xl text-fg-6">
          <span className="text-emerald-500/60">❯</span>
          <span className="fs-blink text-fg-4"> ▋</span>
        </div>
        <p className="font-mono text-sm text-fg-4">
          select a run or start a new one
        </p>
      </div>
    )
  }

  const busy = status === "busy"

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-term">
      <header className="flex items-center gap-3 border-b border-line bg-base px-4 py-2.5">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Open sidebar"
          className="-ml-1 rounded-lg p-1.5 text-fg-3 hover:bg-elevated md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-fg">
            {session?.title?.trim() || "untitled run"}
          </h2>
          {session?.agent && (
            <p className="truncate font-mono text-xs text-fg-4">
              {session.agent}
            </p>
          )}
        </div>
        <StatusBadge status={status} />
        {busy && (
          <button
            type="button"
            onClick={() => void abortSession()}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 font-mono text-xs text-fg-2 transition-colors hover:border-red-500/50 hover:text-red-400"
          >
            <Square className="h-3 w-3 fill-current" />
            stop
          </button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4">
          {messages.length === 0 ? (
            <p className="py-10 text-center font-mono text-xs text-fg-6">
              <span className="text-emerald-500/60">❯</span> waiting for input
              <span className="fs-blink"> ▋</span>
            </p>
          ) : (
            messages.map((message, index) => (
              <Fragment key={message.id}>
                {index > 0 && message.role === "user" && (
                  <div className="border-t border-line/70" />
                )}
                <ExecutionBlock message={message} />
              </Fragment>
            ))
          )}
          {todos.length > 0 && <TodoProgress todos={[...todos]} />}
        </div>
      </div>

      {sendError && (
        <div className="flex items-center gap-2 border-t border-red-500/20 bg-red-500/10 px-4 py-2 font-mono text-xs text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{sendError}</span>
        </div>
      )}

      <InputBar />
    </div>
  )
}

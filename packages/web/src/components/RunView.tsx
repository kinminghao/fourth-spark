import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { AlertTriangle, CornerDownLeft, Menu, Square } from "lucide-react"
import clsx from "clsx"
import {
  EMPTY_MESSAGES,
  EMPTY_TODOS,
  useSessionStore,
} from "../stores/session-store"
import { useRepoStore } from "../stores/repo-store"
import { useAgentStore } from "../stores/agent-store"
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

const MAX_NEW_HEIGHT_PX = 144

function NewSessionInput({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const [draft, setDraft] = useState("")
  const [agent, setAgent] = useState("")
  const [model, setModel] = useState("")
  const [variant, setVariant] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const createSession = useSessionStore((state) => state.createSession)
  const sendError = useSessionStore((state) => state.sendError)
  const activeRepoId = useRepoStore((state) => state.activeRepoId)
  const agents = useAgentStore((state) => state.agents)

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_NEW_HEIGHT_PX)}px`
  }, [draft])

  const submit = () => {
    const text = draft.trim()
    if (!text || !activeRepoId) return
    setDraft("")
    void createSession(
      text,
      agent || undefined,
      model.trim() || undefined,
      variant.trim() || undefined,
    )
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center bg-term">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Open sidebar"
        className="absolute left-3 top-3 rounded-lg p-2 text-fg-3 hover:bg-elevated md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="w-full max-w-2xl px-6">
        <div className="mb-8 text-center">
          <div className="font-mono text-2xl text-fg-6">
            <span className="text-emerald-500/60">❯</span>
            <span className="fs-blink text-fg-4"> ▋</span>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-base/80 shadow-sm transition-colors focus-within:border-fg-5">
          <div className="flex items-start gap-2 px-4 py-3">
            <span className="select-none pt-px font-mono text-sm leading-6 text-emerald-400">
              ❯
            </span>
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              autoFocus
              disabled={!activeRepoId}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={activeRepoId ? "让 Agent 做什么？" : "请先选择一个仓库"}
              className="flex-1 resize-none bg-transparent font-mono text-sm leading-6 text-fg placeholder:text-fg-6 focus:outline-none disabled:cursor-not-allowed"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!activeRepoId || draft.trim().length === 0}
              aria-label="Start run"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-4 transition-colors duration-150 hover:bg-elevated hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-4"
            >
              <CornerDownLeft className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-3 border-t border-line/60 px-4 py-2">
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-fg-4">
              <span className="shrink-0">Agent</span>
              <select
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className="rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-fg focus:border-fg-5 focus:outline-none"
              >
                <option value="">默认</option>
                {agents.map((a) => {
                  const val = a.id || a.name
                  return <option key={val} value={val}>{a.name}</option>
                })}
              </select>
            </label>
            <label className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[11px] text-fg-4">
              <span className="shrink-0">Model</span>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="claude-sonnet-4-6"
                className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-fg placeholder:text-fg-6 focus:border-fg-5 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-fg-4">
              <span className="shrink-0">Variant</span>
              <input
                type="text"
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                placeholder="max"
                className="w-16 rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-fg placeholder:text-fg-6 focus:border-fg-5 focus:outline-none"
              />
            </label>
          </div>
        </div>

        <div className="mt-2 text-center font-mono text-[10px] text-fg-6">
          ⌘⏎ / ctrl+⏎ 开始运行
        </div>

        {sendError && (
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 font-mono text-xs text-red-400">
            {sendError}
          </div>
        )}
      </div>
    </div>
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
    return <NewSessionInput onToggleSidebar={onToggleSidebar} />
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

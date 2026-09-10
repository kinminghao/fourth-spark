import {
  Fragment,
  useEffect,
  useRef,
  useState,
} from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangle, ArrowLeft, ChevronDown, Menu, PanelRight, Plus, RotateCcw, Square } from "lucide-react"
import clsx from "clsx"
import {
  EMPTY_MESSAGES,
  EMPTY_QUEUE,
  EMPTY_TODOS,
  useSessionStore,
} from "../stores/session-store"
import type { Message as ApiMessage } from "../lib/api-client"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { useIssueStore } from "../stores/issue-store"
import { orchestrator } from "../lib/session-orchestrator"
import { ExecutionBlock } from "./ExecutionBlock"
import { TodoProgressCompact } from "./TodoProgress"
import { InputBar } from "./InputBar"
import { StatusBadge } from "./run/StatusBadge"
import { ContextInfo } from "./run/ContextInfo"
import { NewSessionInput } from "./run/NewSessionInput"
import { IssueMatchView } from "./run/IssueMatchView"

const STICK_TO_BOTTOM_THRESHOLD_PX = 64

export function RunView({
  onToggleSidebar,
  onToggleRightPanel,
  rightPanelOpen,
}: {
  onToggleSidebar?: () => void
  onToggleRightPanel?: () => void
  rightPanelOpen?: boolean
}) {
  const navigate = useNavigate()
  const repoName = useRepoStore(selectActiveRepoName)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const session = useSessionStore(
    (state) =>
      state.sessions.find((item) => item.id === state.activeSessionId) ?? null,
  )
  const messages = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? (state.messages[id] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES
  })
  const todos = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? (state.todos[id] ?? EMPTY_TODOS) : EMPTY_TODOS
  })
  const status = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? state.sessionStatuses[id] : undefined
  })
  const queuedIds = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? (state.queuedMessageIds[id] ?? EMPTY_QUEUE) : EMPTY_QUEUE
  })
  const errorReason = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? state.errorReasons[id] : undefined
  })
  const messagesMeta = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? state.messagesMeta[id] : undefined
  })
  const loadMoreMessages = useSessionStore((state) => state.loadMoreMessages)
  const sendError = useSessionStore((state) => state.sendError)
  const abortSession = useSessionStore((state) => state.abortSession)
  const revertToMessage = useSessionStore((state) => state.revertToMessage)
  const activeRepo = useRepoStore((state) => state.repos.find((r) => r.id === state.activeRepoId))
  const canRevert = activeRepo?.runtimeType !== "claude-code"
  const [revertingId, setRevertingId] = useState<string | null>(null)
  const [headerExpanded, setHeaderExpanded] = useState(false)
  const linkedIssue = useIssueStore((state) =>
    session?.issueId ? state.issues.find((i) => i.id === session.issueId) : undefined,
  )

  useEffect(() => {
    if (!activeSessionId) return
    orchestrator.activateSession(activeSessionId)
    return () => orchestrator.deactivateSession(activeSessionId)
  }, [activeSessionId])

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  useEffect(() => {
    const element = scrollRef.current
    if (element && stickToBottomRef.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [messages, todos])

  useEffect(() => {
    stickToBottomRef.current = true
    setShowScrollToBottom(false)
  }, [activeSessionId])

  useEffect(() => {
    if (status !== "busy" && status !== "retry") return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) return
      void abortSession()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [status, abortSession])

  const matchingParentId = useIssueStore((state) => state.matchingParentId)

  if (!activeSessionId) {
    if (matchingParentId) return <IssueMatchView onToggleSidebar={onToggleSidebar} />
    return <NewSessionInput onToggleSidebar={onToggleSidebar} />
  }

  const busy = status === "busy"
  const retrying = status === "retry"
  const stoppable = busy || retrying

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-term">
      {/* ── Mobile header (< md) ── */}
      <header className="border-b border-line bg-base md:hidden">
        <div
          className="flex items-center gap-2 px-3 py-2"
          onClick={() => setHeaderExpanded((v) => !v)}
        >
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label="Open sidebar"
              className="-ml-1 rounded-lg p-1.5 text-fg-3 hover:bg-elevated"
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => useSessionStore.setState({ activeSessionId: null })}
              aria-label="新建运行"
              title="新建运行"
              className="rounded-lg p-1.5 text-fg-3 hover:bg-elevated"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            {session?.parentID && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void useSessionStore.getState().setActiveSession(session.parentID!) }}
                className="mb-0.5 flex items-center gap-1 text-[11px] text-fg-4 transition-colors hover:text-blue-400"
              >
                <ArrowLeft className="h-3 w-3" />
                返回父会话
              </button>
            )}
            <h2 className="text-sm font-medium leading-snug text-fg">
              {session?.title?.trim() || "untitled run"}
            </h2>
          </div>
          {stoppable && (
            <span className={clsx("h-2 w-2 shrink-0 rounded-full", retrying ? "bg-amber-400 animate-pulse" : "bg-amber-400 animate-pulse")} />
          )}
          {!stoppable && status === "error" && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
          )}
          <ChevronDown className={clsx("h-4 w-4 shrink-0 text-fg-5 transition-transform duration-200", headerExpanded && "rotate-180")} />
        </div>
        <div
          className={clsx(
            "grid transition-[grid-template-rows] duration-200 ease-in-out",
            headerExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-2.5 border-t border-line/60 px-4 py-3">
              {session?.agent && (
                <div className="flex items-center gap-2 font-mono text-xs text-fg-4">
                  <span className="w-14 shrink-0 text-fg-5">Agent</span>
                  <span className="truncate">{session.agent}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 font-mono text-xs text-fg-5">Status</span>
                <StatusBadge status={status} reason={errorReason} />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 font-mono text-xs text-fg-5">Context</span>
                <ContextInfo session={session} messages={messages} />
              </div>
              {linkedIssue && (
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 font-mono text-xs text-fg-5">Issue</span>
                  <button
                    type="button"
                    onClick={() => navigate(`/${encodeURIComponent(repoName!)}/dev/issues?id=${linkedIssue.id}`)}
                    className="flex items-center gap-1.5 truncate font-mono text-xs text-fg-3 transition-colors hover:text-blue-400"
                  >
                    <span className={clsx(
                      "shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold",
                      linkedIssue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
                    )}>
                      #{linkedIssue.number}
                    </span>
                    <span className="truncate">{linkedIssue.title}</span>
                  </button>
                </div>
              )}
              {stoppable && (
                <button
                  type="button"
                  onClick={() => void abortSession()}
                  className="mt-0.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 font-mono text-xs text-fg-2 transition-colors hover:border-red-500/50 hover:text-red-400"
                >
                  <Square className="h-3 w-3 fill-current" />
                  {retrying ? "stop retry" : "stop"}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Desktop header (md+) ── */}
      <header className="hidden items-center gap-3 border-b border-line bg-base px-4 py-2.5 md:flex">
        <div className="min-w-0 flex-1">
          {session?.parentID && (
            <button
              type="button"
              onClick={() => void useSessionStore.getState().setActiveSession(session.parentID!)}
              className="mb-0.5 flex items-center gap-1 text-[11px] text-fg-4 transition-colors hover:text-blue-400"
            >
              <ArrowLeft className="h-3 w-3" />
              返回父会话
            </button>
          )}
          <h2 className="truncate text-sm font-medium text-fg">
            {session?.title?.trim() || "untitled run"}
          </h2>
          {session?.agent && (
            <p className="truncate font-mono text-xs text-fg-4">
              {session.agent}
            </p>
          )}
          <ContextInfo session={session} messages={messages} />
        </div>
        {linkedIssue && (
          <button
            type="button"
            onClick={() => navigate(`/${encodeURIComponent(repoName!)}/dev/issues?id=${linkedIssue.id}`)}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-xs text-fg-3 transition-colors hover:border-fg-5 hover:text-fg"
          >
            <span className={clsx(
              "rounded px-1 py-0.5 text-[10px] font-semibold",
              linkedIssue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
            )}>
              #{linkedIssue.number}
            </span>
            <span className="hidden max-w-[120px] truncate sm:inline">{linkedIssue.title}</span>
          </button>
        )}
        <StatusBadge status={status} reason={errorReason} />
        {onToggleRightPanel && (
          <button
            type="button"
            onClick={onToggleRightPanel}
            aria-label={rightPanelOpen ? "关闭侧边栏" : "打开侧边栏"}
            className={clsx(
              "flex items-center justify-center rounded-md border border-line p-1.5 transition-colors",
              rightPanelOpen
                ? "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20"
                : "text-fg-4 hover:bg-elevated hover:text-fg-2",
            )}
          >
            <PanelRight className="h-4 w-4" />
          </button>
        )}
        {stoppable && (
          <button
            type="button"
            onClick={() => void abortSession()}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 font-mono text-xs text-fg-2 transition-colors hover:border-red-500/50 hover:text-red-400"
          >
            <Square className="h-3 w-3 fill-current" />
            {retrying ? "stop retry" : "stop"}
          </button>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={() => {
            const element = scrollRef.current
            if (!element) return
            const atBottom =
              element.scrollHeight - element.clientHeight - element.scrollTop <=
              STICK_TO_BOTTOM_THRESHOLD_PX
            stickToBottomRef.current = atBottom
            setShowScrollToBottom(!atBottom)

            if (
              element.scrollTop < 200 &&
              activeSessionId &&
              messagesMeta?.hasMore &&
              !messagesMeta.loading
            ) {
              const prevHeight = element.scrollHeight
              loadMoreMessages(activeSessionId).then(() => {
                requestAnimationFrame(() => {
                  if (scrollRef.current) {
                    scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight
                  }
                })
              })
            }
          }}
          className="h-full overflow-y-auto"
        >
          <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4">
            {messagesMeta?.loading && (
              <div className="flex justify-center py-2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-fg-5 border-t-transparent" />
              </div>
            )}
            {messagesMeta && !messagesMeta.loading && messagesMeta.hasMore && (
              <button
                type="button"
                onClick={() => activeSessionId && loadMoreMessages(activeSessionId)}
                className="mx-auto rounded-md border border-line px-3 py-1 font-mono text-xs text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-2"
              >
                加载更早的消息
              </button>
            )}
            {messages.length === 0 ? (
              <p className="py-10 text-center font-mono text-xs text-fg-6">
                <span className="text-emerald-500/60">❯</span> waiting for input
                <span className="fs-blink"> ▋</span>
              </p>
            ) : (
              messages.map((message, index) => (
                <Fragment key={message.id}>
                  {index > 0 && message.role === "user" && (
                    <div className="group/revert relative border-t border-line py-2">
                      {canRevert && !stoppable && (
                        <button
                          type="button"
                          disabled={revertingId !== null}
                          onClick={async () => {
                            const count = messages.length - index
                            if (!window.confirm(`回退到此处？将移除后续 ${count} 条对话记录（不影响已产生的代码改动）。`)) return
                            setRevertingId(message.id)
                            await revertToMessage(activeSessionId!, message.id)
                            setRevertingId(null)
                          }}
                          className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-line bg-base px-2.5 py-1 font-mono text-[11px] text-fg-4 opacity-60 shadow-sm transition-all duration-150 hover:border-amber-500/50 hover:text-amber-400 md:opacity-30 md:group-hover/revert:opacity-100 disabled:opacity-50"
                        >
                          {revertingId === message.id ? (
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                          回退到此处
                        </button>
                      )}
                    </div>
                  )}
                  <div data-message-id={message.id}>
                    <ExecutionBlock message={message} isStreaming={busy && index === messages.length - 1} queued={queuedIds.includes(message.id)} />
                  </div>
                </Fragment>
              ))
            )}
            {todos.length > 0 && (
              <TodoProgressCompact
                todos={[...todos]}
                onClick={onToggleRightPanel}
              />
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            const el = scrollRef.current
            if (!el) return
            el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
            stickToBottomRef.current = true
          }}
          aria-label="滚动到底部"
          className={clsx(
            "absolute bottom-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface/90 text-fg-4 shadow-lg backdrop-blur transition-all duration-200",
            "hover:bg-elevated hover:text-fg-2",
            showScrollToBottom
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-2 opacity-0",
          )}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {status === "error" && errorReason && (
        <div className="flex items-center gap-2 border-t border-red-500/20 bg-red-500/10 px-4 py-2 font-mono text-xs text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{errorReason}</span>
        </div>
      )}
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

import { useState, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import clsx from "clsx"
import { ListTodo, MessageSquare, Link2, GitBranch, Plus, X, Search } from "lucide-react"
import type { Message, Todo, SessionLinks, Session } from "../lib/api-client"
import { normalizeTodoStatus, type TodoStatus } from "../lib/message-parts"
import { useIssueStore } from "../stores/issue-store"
import { usePrStore } from "../stores/pr-store"
import { useSessionStore } from "../stores/session-store"

const MARK: Record<TodoStatus, { glyph: string; color: string; spin: boolean }> = {
  completed: { glyph: "✓", color: "text-emerald-400", spin: false },
  in_progress: { glyph: "◌", color: "text-amber-400", spin: true },
  cancelled: { glyph: "✗", color: "text-fg-5", spin: false },
  pending: { glyph: "○", color: "text-fg-4", spin: false },
}

type Tab = "todo" | "prompts" | "links" | "subtasks"

function formatTime(msg: Message): string {
  const raw = msg.time?.created
  if (!raw) return ""
  const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw
  const date = new Date(ms)
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

function getTextPreview(msg: Message): string {
  if (!msg.parts) return ""
  for (const part of msg.parts) {
    const text = part.content ?? part.text
    if (text) return text
  }
  return ""
}

function TodoTab({ todos }: { todos: readonly Todo[] }) {
  if (todos.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="font-mono text-xs text-fg-5">暂无待办项</p>
      </div>
    )
  }

  const doneCount = todos.filter((t) => {
    const st = normalizeTodoStatus(t.status)
    return st === "completed" || st === "cancelled"
  }).length

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      <div className="mb-2 font-mono text-[10px] tabular-nums text-fg-5">
        进度 {doneCount}/{todos.length}
      </div>
      <ul className="space-y-1.5">
        {todos.map((todo) => {
          const st = normalizeTodoStatus(todo.status)
          const mark = MARK[st]
          const done = st === "completed" || st === "cancelled"
          return (
            <li key={todo.id} className="flex items-start gap-2 font-mono text-xs">
              <span className={clsx("shrink-0 leading-5", mark.color, mark.spin && "fs-spin")}>
                {mark.glyph}
              </span>
              <span className={clsx("leading-5", done ? "text-fg-5 line-through" : "text-fg-2")}>
                {todo.content}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PromptsTab({
  messages,
  onScrollToMessage,
}: {
  messages: readonly Message[]
  onScrollToMessage?: (messageId: string) => void
}) {
  const userMessages = messages.filter((m) => m.role === "user")

  if (userMessages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="font-mono text-xs text-fg-5">暂无输入记录</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      <ul className="space-y-1">
        {userMessages.map((msg, index) => {
          const preview = getTextPreview(msg)
          const time = formatTime(msg)
          return (
            <li key={msg.id}>
              <button
                type="button"
                onClick={() => onScrollToMessage?.(msg.id)}
                className="group w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-elevated/60"
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-[10px] text-emerald-400/60">
                    ❯
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-fg-5">
                    #{index + 1}
                  </span>
                  {time && (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-6">{time}</span>
                  )}
                </div>
                {preview && (
                  <p className="mt-0.5 line-clamp-2 pl-5 text-xs leading-relaxed text-fg-3 group-hover:text-fg-2">
                    {preview}
                  </p>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function LinkMatchRow({
  linked,
  number,
  title,
  state,
  mergedAt,
  isPr,
  onToggle,
}: {
  linked: boolean
  number: number
  title: string
  state: string
  mergedAt?: number | null
  isPr?: boolean
  onToggle: () => void
}) {
  const badgeColor = isPr
    ? state === "open" ? "bg-emerald-500/15 text-emerald-400"
      : mergedAt ? "bg-purple-500/15 text-purple-400"
      : "bg-red-500/15 text-red-400"
    : state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400"

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={clsx(
          "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
          linked
            ? "border-l-2 border-emerald-500 bg-emerald-500/5"
            : "border-l-2 border-transparent hover:bg-elevated/50",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className={clsx("shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-semibold", badgeColor)}>
            #{number}
          </span>
          <span className="min-w-0 truncate text-xs text-fg-2">{title}</span>
          {linked && <Link2 className="ml-auto h-3 w-3 shrink-0 text-emerald-400" />}
        </div>
      </button>
    </li>
  )
}

type MatchMode = null | "issue" | "pr"

function LinksTab({ links, sessionId }: { links?: SessionLinks; sessionId: string | null }) {
  const navigate = useNavigate()
  const repoName = useRepoStore(selectActiveRepoName)
  const [matchMode, setMatchMode] = useState<MatchMode>(null)
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const allIssues = useIssueStore((s) => s.issues)
  const allPrs = usePrStore((s) => s.pulls)
  const addLink = useSessionStore((s) => s.addLink)
  const removeLink = useSessionStore((s) => s.removeLink)

  const linkedIssueIds = new Set(links?.issues?.map((i) => i.id) ?? [])
  const linkedPrIds = new Set(links?.pullRequests?.map((p) => p.id) ?? [])

  useEffect(() => {
    if (matchMode) inputRef.current?.focus()
  }, [matchMode])

  const exitMatch = () => { setMatchMode(null); setQuery("") }

  const handleToggle = async (type: "issue" | "pr", targetId: string, isLinked: boolean) => {
    if (!sessionId) return
    if (isLinked) {
      await removeLink(sessionId, type, targetId)
    } else {
      await addLink(sessionId, type, targetId)
    }
  }

  const q = query.trim().toLowerCase()
  const filteredIssues = !q
    ? allIssues
    : allIssues.filter((i) => `#${i.number} ${i.title}`.toLowerCase().includes(q))
  const filteredPrs = !q
    ? allPrs
    : allPrs.filter((p) => `#${p.number} ${p.title} ${p.headBranch}`.toLowerCase().includes(q))

  const issueCount = links?.issues?.length ?? 0
  const prCount = links?.pullRequests?.length ?? 0

  if (matchMode) {
    const isIssueMode = matchMode === "issue"
    const items = isIssueMode ? filteredIssues : filteredPrs
    const linkedIds = isIssueMode ? linkedIssueIds : linkedPrIds

    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">
            {isIssueMode ? "关联 Issue" : "关联 PR"}
          </span>
          <button
            type="button"
            onClick={exitMatch}
            className="flex h-6 items-center gap-1 rounded-md px-2 text-xs text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
          >
            <X className="h-3.5 w-3.5" />
            完成
          </button>
        </div>
        <div className="border-b border-line px-3 py-2">
          <div className="flex items-center gap-2 rounded-md border border-line bg-base px-2 py-1">
            <Search className="h-3.5 w-3.5 shrink-0 text-fg-5" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={isIssueMode ? "搜索 issue..." : "搜索 PR..."}
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-fg placeholder:text-fg-6 focus:outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="shrink-0 text-fg-5 hover:text-fg-3">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {items.length === 0 ? (
            <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">
              {(isIssueMode ? allIssues : allPrs).length === 0
                ? (isIssueMode ? "暂无 Issue，请先同步" : "暂无 PR，请先同步")
                : "无匹配结果"}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {items.map((item) => (
                <LinkMatchRow
                  key={item.id}
                  linked={linkedIds.has(item.id)}
                  number={item.number}
                  title={item.title}
                  state={item.state}
                  mergedAt={isIssueMode ? undefined : (item as typeof allPrs[number]).mergedAt}
                  isPr={!isIssueMode}
                  onToggle={() => handleToggle(matchMode, item.id, linkedIds.has(item.id))}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="flex-1 font-mono text-[10px] text-fg-5">
          {issueCount + prCount > 0 ? `${issueCount + prCount} 项关联` : "暂无关联"}
        </span>
        <button
          type="button"
          onClick={() => setMatchMode("issue")}
          className="flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-fg-4 transition-colors hover:border-emerald-500/50 hover:text-emerald-400"
        >
          <Plus className="h-3 w-3" />
          <span className="text-[10px] font-medium">Issue</span>
        </button>
        <button
          type="button"
          onClick={() => setMatchMode("pr")}
          className="flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-fg-4 transition-colors hover:border-blue-500/50 hover:text-blue-400"
        >
          <Plus className="h-3 w-3" />
          <span className="text-[10px] font-medium">PR</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {issueCount > 0 && (
          <div className="mb-3">
            <div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-5">
              Issues ({issueCount})
            </div>
            <ul className="space-y-1">
              {links!.issues.map((issue) => (
                <li key={issue.id} className="group flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/${encodeURIComponent(repoName!)}/issues?issueId=${encodeURIComponent(issue.id)}`)}
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-elevated/60"
                  >
                    <span className={clsx(
                      "mt-0.5 shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-semibold",
                      issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
                    )}>
                      #{issue.number}
                    </span>
                    <span className="line-clamp-2 text-xs leading-5 text-fg-3 group-hover:text-fg-2">
                      {issue.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggle("issue", issue.id, true)}
                    className="mt-1.5 hidden shrink-0 rounded p-0.5 text-fg-5 transition-colors hover:bg-red-500/15 hover:text-red-400 group-hover:block"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {prCount > 0 && (
          <div>
            <div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-5">
              Pull Requests ({prCount})
            </div>
            <ul className="space-y-1">
              {links!.pullRequests.map((pr) => (
                <li key={pr.id} className="group flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/${encodeURIComponent(repoName!)}/pulls?prId=${encodeURIComponent(pr.id)}`)}
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-elevated/60"
                  >
                    <span className={clsx(
                      "mt-0.5 shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-semibold",
                      pr.state === "open" ? "bg-emerald-500/15 text-emerald-400"
                        : pr.mergedAt ? "bg-purple-500/15 text-purple-400"
                        : "bg-red-500/15 text-red-400",
                    )}>
                      #{pr.number}
                    </span>
                    <span className="line-clamp-2 text-xs leading-5 text-fg-3 group-hover:text-fg-2">
                      {pr.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggle("pr", pr.id, true)}
                    className="mt-1.5 hidden shrink-0 rounded p-0.5 text-fg-5 transition-colors hover:bg-red-500/15 hover:text-red-400 group-hover:block"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {issueCount === 0 && prCount === 0 && (
          <div className="flex flex-1 items-center justify-center py-10">
            <p className="font-mono text-xs text-fg-5">点击上方按钮添加关联</p>
          </div>
        )}
      </div>
    </div>
  )
}

const AGENT_COLORS: Record<string, string> = {
  "visual-engineering": "bg-purple-500/15 text-purple-400",
  quick: "bg-emerald-500/15 text-emerald-400",
  deep: "bg-blue-500/15 text-blue-400",
  ultrabrain: "bg-amber-500/15 text-amber-400",
  artistry: "bg-pink-500/15 text-pink-400",
  writing: "bg-cyan-500/15 text-cyan-400",
  explore: "bg-teal-500/15 text-teal-400",
  librarian: "bg-indigo-500/15 text-indigo-400",
  oracle: "bg-amber-500/15 text-amber-400",
  metis: "bg-rose-500/15 text-rose-400",
  momus: "bg-orange-500/15 text-orange-400",
}

function subtaskStatusDot(status: string | undefined): string {
  switch (status) {
    case "idle": return "bg-emerald-500"
    case "busy": case "retry": return "bg-amber-500 animate-pulse"
    case "error": return "bg-red-500"
    default: return "bg-fg-5"
  }
}

function subtaskCreatedMs(session: Session): number | null {
  const raw = session.time?.created
  if (raw) return raw < 1_000_000_000_000 ? raw * 1000 : raw
  if (session.createdAt) {
    const parsed = Date.parse(session.createdAt)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

function formatElapsed(ms: number): string {
  const diff = Date.now() - ms
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return "just now"
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function SubtasksTab() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sessionStatuses = useSessionStore((s) => s.sessionStatuses)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const parentId = activeSession?.parentID ?? activeSessionId
  const isSiblingView = !!activeSession?.parentID

  const children = sessions
    .filter((s) => s.parentID === parentId)
    .sort((a, b) => (subtaskCreatedMs(b) ?? 0) - (subtaskCreatedMs(a) ?? 0))

  if (children.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="font-mono text-xs text-fg-5">暂无子任务</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2">
      {isSiblingView && (
        <div className="mb-1.5 px-2 font-mono text-[10px] text-fg-5">
          同级子任务 ({children.length})
        </div>
      )}
      <ul className="space-y-0.5">
        {children.map((child) => {
          const isCurrent = child.id === activeSessionId
          const status = sessionStatuses[child.id]
          const created = subtaskCreatedMs(child)
          const agentColor = (child.agent && AGENT_COLORS[child.agent]) ?? "bg-elevated text-fg-4"
          const title = child.title || `${child.id.slice(0, 9)}...`
          return (
            <li key={child.id}>
              <button
                type="button"
                onClick={() => { if (!isCurrent) void setActiveSession(child.id) }}
                className={clsx(
                  "group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  isCurrent
                    ? "border-l-2 border-blue-500 bg-blue-500/5"
                    : "border-l-2 border-transparent hover:bg-elevated/60",
                )}
              >
                <span className={clsx("mt-1 h-2 w-2 shrink-0 rounded-full", subtaskStatusDot(status))} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {child.agent && (
                      <span className={clsx("shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-medium", agentColor)}>
                        {child.agent}
                      </span>
                    )}
                    {created != null && (
                      <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-fg-6">
                        {formatElapsed(created)}
                      </span>
                    )}
                  </div>
                  <p className={clsx(
                    "mt-0.5 line-clamp-2 text-xs leading-5",
                    isCurrent ? "text-fg-2" : "text-fg-3 group-hover:text-fg-2",
                  )}>
                    {title}
                  </p>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function SidePanel({
  todos,
  messages,
  sessionLinks,
  sessionId,
  onScrollToMessage,
}: {
  todos: readonly Todo[]
  messages: readonly Message[]
  sessionLinks?: SessionLinks
  sessionId: string | null
  onScrollToMessage?: (messageId: string) => void
}) {
  const [activeTab, setActiveTab] = useState<Tab>("todo")

  const allSessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const userCount = messages.filter((m) => m.role === "user").length
  const linkCount = (sessionLinks?.issues?.length ?? 0) + (sessionLinks?.pullRequests?.length ?? 0)
  const activeSession = allSessions.find((s) => s.id === activeSessionId)
  const subtaskParentId = activeSession?.parentID ?? activeSessionId
  const subtaskCount = allSessions.filter((s) => s.parentID === subtaskParentId).length

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center border-b border-line">
        <button
          type="button"
          onClick={() => setActiveTab("todo")}
          className={clsx(
            "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
            activeTab === "todo"
              ? "border-blue-500 text-blue-500"
              : "border-transparent text-fg-4 hover:text-fg-2",
          )}
        >
          <ListTodo className="h-3.5 w-3.5" />
          待办
          {todos.length > 0 && (
            <span className="rounded-full bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">
              {todos.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("prompts")}
          className={clsx(
            "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
            activeTab === "prompts"
              ? "border-blue-500 text-blue-500"
              : "border-transparent text-fg-4 hover:text-fg-2",
          )}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          输入
          {userCount > 0 && (
            <span className="rounded-full bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">
              {userCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("links")}
          className={clsx(
            "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
            activeTab === "links"
              ? "border-blue-500 text-blue-500"
              : "border-transparent text-fg-4 hover:text-fg-2",
          )}
        >
          <Link2 className="h-3.5 w-3.5" />
          关联
          {linkCount > 0 && (
            <span className="rounded-full bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">
              {linkCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("subtasks")}
          className={clsx(
            "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
            activeTab === "subtasks"
              ? "border-blue-500 text-blue-500"
              : "border-transparent text-fg-4 hover:text-fg-2",
          )}
        >
          <GitBranch className="h-3.5 w-3.5" />
          子任务
          {subtaskCount > 0 && (
            <span className="rounded-full bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">
              {subtaskCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === "todo" ? (
        <TodoTab todos={todos} />
      ) : activeTab === "prompts" ? (
        <PromptsTab messages={messages} onScrollToMessage={onScrollToMessage} />
      ) : activeTab === "links" ? (
        <LinksTab links={sessionLinks} sessionId={sessionId} />
      ) : (
        <SubtasksTab />
      )}
    </div>
  )
}

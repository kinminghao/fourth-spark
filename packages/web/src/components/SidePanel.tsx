import { useState, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import clsx from "clsx"
import { ListTodo, MessageSquare, Link2, Plus, X, Search } from "lucide-react"
import type { Message, Todo, SessionLinks } from "../lib/api-client"
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

type Tab = "todo" | "prompts" | "links"

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

function LinksTab({ links, sessionId }: { links?: SessionLinks; sessionId: string | null }) {
  const navigate = useNavigate()
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const allIssues = useIssueStore((s) => s.issues)
  const allPrs = usePrStore((s) => s.pulls)
  const addLink = useSessionStore((s) => s.addLink)
  const removeLink = useSessionStore((s) => s.removeLink)

  const linkedIssueIds = new Set(links?.issues?.map((i) => i.id) ?? [])
  const linkedPrIds = new Set(links?.pullRequests?.map((p) => p.id) ?? [])

  useEffect(() => {
    if (searching) inputRef.current?.focus()
  }, [searching])

  const q = query.trim().toLowerCase()
  const candidateIssues = q
    ? allIssues.filter((i) => !linkedIssueIds.has(i.id) && `#${i.number} ${i.title}`.toLowerCase().includes(q))
    : []
  const candidatePrs = q
    ? allPrs.filter((p) => !linkedPrIds.has(p.id) && `#${p.number} ${p.title} ${p.headBranch}`.toLowerCase().includes(q))
    : []

  const handleAdd = async (type: "issue" | "pr", targetId: string) => {
    if (!sessionId) return
    await addLink(sessionId, type, targetId)
    setQuery("")
    setSearching(false)
  }

  const handleRemove = async (type: "issue" | "pr", targetId: string) => {
    if (!sessionId) return
    await removeLink(sessionId, type, targetId)
  }

  const issueCount = links?.issues?.length ?? 0
  const prCount = links?.pullRequests?.length ?? 0

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* search bar */}
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        {searching ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line bg-base px-2 py-1">
            <Search className="h-3 w-3 shrink-0 text-fg-5" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索 issue / PR..."
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-fg placeholder:text-fg-6 focus:outline-none"
            />
            <button type="button" onClick={() => { setSearching(false); setQuery("") }} className="shrink-0 text-fg-5 hover:text-fg-3">
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <>
            <span className="flex-1 font-mono text-[10px] text-fg-5">
              {issueCount + prCount > 0 ? `${issueCount + prCount} 项关联` : "暂无关联"}
            </span>
            <button
              type="button"
              onClick={() => setSearching(true)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {/* search results */}
      {searching && q && (candidateIssues.length > 0 || candidatePrs.length > 0) && (
        <div className="max-h-40 overflow-y-auto border-b border-line bg-base px-3 py-2">
          {candidateIssues.slice(0, 5).map((issue) => (
            <button
              key={issue.id}
              type="button"
              onClick={() => handleAdd("issue", issue.id)}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-elevated/60"
            >
              <span className="mt-0.5 shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 font-mono text-[10px] font-semibold text-emerald-400">
                #{issue.number}
              </span>
              <span className="line-clamp-1 text-xs leading-5 text-fg-3">{issue.title}</span>
            </button>
          ))}
          {candidatePrs.slice(0, 5).map((pr) => (
            <button
              key={pr.id}
              type="button"
              onClick={() => handleAdd("pr", pr.id)}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-elevated/60"
            >
              <span className="mt-0.5 shrink-0 rounded bg-blue-500/15 px-1 py-0.5 font-mono text-[10px] font-semibold text-blue-400">
                PR#{pr.number}
              </span>
              <span className="line-clamp-1 text-xs leading-5 text-fg-3">{pr.title}</span>
            </button>
          ))}
        </div>
      )}
      {searching && q && candidateIssues.length === 0 && candidatePrs.length === 0 && (
        <div className="border-b border-line px-3 py-3 text-center font-mono text-xs text-fg-5">
          无匹配结果
        </div>
      )}

      {/* linked items */}
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
                    onClick={() => navigate(`/issues?issueId=${encodeURIComponent(issue.id)}`)}
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
                    onClick={() => handleRemove("issue", issue.id)}
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
                    onClick={() => navigate(`/pulls?prId=${encodeURIComponent(pr.id)}`)}
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
                    onClick={() => handleRemove("pr", pr.id)}
                    className="mt-1.5 hidden shrink-0 rounded p-0.5 text-fg-5 transition-colors hover:bg-red-500/15 hover:text-red-400 group-hover:block"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {issueCount === 0 && prCount === 0 && !searching && (
          <div className="flex flex-1 items-center justify-center py-10">
            <p className="font-mono text-xs text-fg-5">点击 + 添加关联</p>
          </div>
        )}
      </div>
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

  const userCount = messages.filter((m) => m.role === "user").length
  const linkCount = (sessionLinks?.issues?.length ?? 0) + (sessionLinks?.pullRequests?.length ?? 0)

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
      </div>

      {activeTab === "todo" ? (
        <TodoTab todos={todos} />
      ) : activeTab === "prompts" ? (
        <PromptsTab messages={messages} onScrollToMessage={onScrollToMessage} />
      ) : (
        <LinksTab links={sessionLinks} sessionId={sessionId} />
      )}
    </div>
  )
}

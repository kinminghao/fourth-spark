import { useState } from "react"
import clsx from "clsx"
import { ListTodo, MessageSquare } from "lucide-react"
import type { Message, Todo } from "../lib/api-client"
import { normalizeTodoStatus, type TodoStatus } from "../lib/message-parts"

const MARK: Record<TodoStatus, { glyph: string; color: string; spin: boolean }> = {
  completed: { glyph: "✓", color: "text-emerald-400", spin: false },
  in_progress: { glyph: "◌", color: "text-amber-400", spin: true },
  cancelled: { glyph: "✗", color: "text-fg-5", spin: false },
  pending: { glyph: "○", color: "text-fg-4", spin: false },
}

type Tab = "todo" | "prompts"

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

export function SidePanel({
  todos,
  messages,
  onScrollToMessage,
}: {
  todos: readonly Todo[]
  messages: readonly Message[]
  onScrollToMessage?: (messageId: string) => void
}) {
  const [activeTab, setActiveTab] = useState<Tab>("todo")

  const userCount = messages.filter((m) => m.role === "user").length

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
      </div>

      {activeTab === "todo" ? (
        <TodoTab todos={todos} />
      ) : (
        <PromptsTab messages={messages} onScrollToMessage={onScrollToMessage} />
      )}
    </div>
  )
}

import { useState } from "react"
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ListTodo,
  Loader2,
  XCircle,
} from "lucide-react"
import clsx from "clsx"
import type { Todo } from "../lib/api-client"
import {
  countCompletedTodos,
  normalizeTodoStatus,
  type TodoStatus,
} from "../lib/message-parts"

const COLLAPSED_COUNT = 3

function TodoIcon({ status }: { status: TodoStatus }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
    case "in_progress":
      return (
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-400" />
      )
    case "cancelled":
      return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
    case "pending":
      return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
    default:
      return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
  }
}

export function TodoProgress({ todos }: { todos: Todo[] }) {
  const [expanded, setExpanded] = useState(false)

  if (todos.length === 0) {
    return null
  }

  const total = todos.length
  const completed = countCompletedTodos(todos)
  const percent = Math.round((completed / total) * 100)
  const visible = expanded ? todos : todos.slice(0, COLLAPSED_COUNT)
  const hiddenCount = total - visible.length

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <ListTodo className="h-4 w-4 shrink-0 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-300">Todos</span>
        <span className="text-xs tabular-nums text-zinc-500">
          {completed}/{total}
        </span>
        <div className="ml-2 h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <ul className="space-y-1">
        {visible.map((todo) => {
          const status = normalizeTodoStatus(todo.status)
          const isDone = status === "completed" || status === "cancelled"
          return (
            <li key={todo.id} className="flex items-start gap-2 text-xs">
              <TodoIcon status={status} />
              <span
                className={clsx(
                  "leading-5",
                  isDone ? "text-zinc-500 line-through" : "text-zinc-300",
                )}
              >
                {todo.content}
              </span>
            </li>
          )
        })}
      </ul>

      {total > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {expanded ? "Show less" : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  )
}

import { useState } from "react"
import clsx from "clsx"
import type { Todo } from "../lib/api-client"
import {
  countCompletedTodos,
  normalizeTodoStatus,
  type TodoStatus,
} from "../lib/message-parts"

const SQUARE: Record<TodoStatus, { glyph: string; color: string }> = {
  completed: { glyph: "■", color: "text-emerald-400" },
  in_progress: { glyph: "■", color: "text-amber-400" },
  cancelled: { glyph: "■", color: "text-zinc-700" },
  pending: { glyph: "□", color: "text-zinc-600" },
}

const MARK: Record<TodoStatus, { glyph: string; color: string; spin: boolean }> = {
  completed: { glyph: "✓", color: "text-emerald-400", spin: false },
  in_progress: { glyph: "◌", color: "text-amber-400", spin: true },
  cancelled: { glyph: "✗", color: "text-zinc-600", spin: false },
  pending: { glyph: "○", color: "text-zinc-500", spin: false },
}

function activeLabel(todos: Todo[]): string {
  const active = todos.find(
    (todo) => normalizeTodoStatus(todo.status) === "in_progress",
  )
  if (active) {
    return active.content
  }
  const pending = todos.find(
    (todo) => normalizeTodoStatus(todo.status) === "pending",
  )
  if (pending) {
    return pending.content
  }
  return "all steps complete"
}

export function TodoProgress({ todos }: { todos: Todo[] }) {
  const [expanded, setExpanded] = useState(false)

  if (todos.length === 0) {
    return null
  }

  const total = todos.length
  const completed = countCompletedTodos(todos)

  return (
    <div className="rounded-md border border-line bg-term/60 px-3 py-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 text-left font-mono text-xs"
      >
        <span className="shrink-0 tabular-nums text-zinc-500">
          [{completed}/{total}]
        </span>
        <span className="shrink-0 tracking-tight">
          {todos.map((todo) => {
            const square = SQUARE[normalizeTodoStatus(todo.status)]
            return (
              <span key={todo.id} className={square.color}>
                {square.glyph}
              </span>
            )
          })}
        </span>
        <span className="min-w-0 flex-1 truncate text-zinc-300">
          {activeLabel(todos)}
        </span>
        <span className="shrink-0 text-zinc-600">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2">
          {todos.map((todo) => {
            const status = normalizeTodoStatus(todo.status)
            const mark = MARK[status]
            const done = status === "completed" || status === "cancelled"
            return (
              <li
                key={todo.id}
                className="flex items-start gap-2 font-mono text-xs"
              >
                <span className={clsx("shrink-0 leading-5", mark.color, mark.spin && "fs-spin")}>
                  {mark.glyph}
                </span>
                <span
                  className={clsx(
                    "leading-5",
                    done ? "text-zinc-600 line-through" : "text-zinc-300",
                  )}
                >
                  {todo.content}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

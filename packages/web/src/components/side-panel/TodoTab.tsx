import clsx from "clsx"
import type { Todo } from "../../lib/api-client"
import { normalizeTodoStatus } from "../../lib/message-parts"
import { MARK } from "./side-panel-utils"

export function TodoTab({ todos }: { todos: readonly Todo[] }) {
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

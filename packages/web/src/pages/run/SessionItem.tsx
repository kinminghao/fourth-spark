import { useEffect, useRef, useState } from "react"
import { Check, CheckCircle2, Copy, Pencil, Pin, Trash2, X } from "lucide-react"
import clsx from "clsx"
import type { Session, Todo } from "../../lib/api-client"
import { countCompletedTodos, normalizeTodoStatus } from "../../lib/message-parts"
import { useDraftStore } from "../../stores/draft-store"
import { sessionTime, formatWhen, copyText, statusDotClass, SWIPE_HINT_KEY } from "./run-page-utils"

export function SessionItem({
  session, isActive, isConfirming, peekHint,
  onSelect, onDelete, onConfirm, onCancelConfirm, onRename, onToggleComplete, onTogglePin,
  status, issue, linkedItems, todos,
}: {
  session: Session; isActive: boolean; isConfirming: boolean; peekHint?: boolean
  onSelect: () => void; onDelete: () => void; onConfirm: () => void; onCancelConfirm: () => void
  onRename: (title: string) => void; onToggleComplete: () => void; onTogglePin: () => void
  status: string | undefined
  issue?: { number: number; title: string; state: string }
  linkedItems?: Array<{ number: number; state: string; type: "issue" | "pr"; mergedAt?: number | null }>
  todos: readonly Todo[]
}) {
  const draft = useDraftStore((s) => s.drafts[session.id])
  const isCompleted = !!session.completedAt
  const isPinned = !!session.pinnedAt
  const when = formatWhen(session)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const editRef = useRef<HTMLInputElement>(null)

  const startEditing = () => {
    setEditValue(session.title?.trim() || "")
    setEditing(true)
    requestAnimationFrame(() => editRef.current?.focus())
  }

  const commitEdit = () => {
    setEditing(false)
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== (session.title?.trim() || "")) {
      onRename(trimmed)
    }
  }

  /* ---- Long-press context menu (mobile) ---- */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggered = useRef(false)

  const clearLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
  }

  /* ---- iOS-style swipe-to-reveal (mobile) ---- */
  const REVEAL_W = 192
  const contentRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const currentX = useRef(0)
  const touch = useRef({ x0: 0, y0: 0, base: 0, dir: null as "h" | "v" | null, on: false })

  /** Apply swipe offset directly to DOM — no React re-render during drag */
  const applyX = (x: number) => {
    currentX.current = x
    const el = contentRef.current
    const ac = actionsRef.current
    if (el) {
      el.style.transform = x !== 0 ? `translateX(${x}px)` : ""
      el.style.pointerEvents = x === -REVEAL_W ? "none" : ""
    }
    if (ac) ac.style.width = `${Math.abs(x)}px`
  }

  const onTS = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touch.current = { x0: t.clientX, y0: t.clientY, base: currentX.current, dir: null, on: true }
    if (contentRef.current) contentRef.current.style.transition = "none"
    if (actionsRef.current) actionsRef.current.style.transition = "none"
    /* Start long-press timer */
    longPressTriggered.current = false
    clearLongPress()
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true
      touch.current.on = false
      setCtxMenu({ x: t.clientX, y: t.clientY })
    }, 500)
  }
  const onTM = (e: React.TouchEvent) => {
    const c = touch.current
    if (!c.on) { clearLongPress(); return }
    const dx = e.touches[0].clientX - c.x0
    const dy = e.touches[0].clientY - c.y0
    if (!c.dir) {
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        c.dir = Math.abs(dx) > Math.abs(dy) ? "h" : "v"
        clearLongPress()
      }
      return
    }
    if (c.dir === "v") return
    applyX(Math.max(-REVEAL_W, Math.min(0, c.base + dx)))
  }
  const snapTo = (target: number) => {
    const el = contentRef.current
    const ac = actionsRef.current
    if (el) el.style.transition = "transform 200ms ease-out"
    if (ac) ac.style.transition = "width 200ms ease-out"
    applyX(target)
  }
  const onTE = () => {
    clearLongPress()
    if (longPressTriggered.current) { longPressTriggered.current = false; return }
    touch.current.on = false
    snapTo(currentX.current < -REVEAL_W / 2 ? -REVEAL_W : 0)
  }
  const closeSwipe = () => snapTo(0)

  /* ---- First-visit peek animation ---- */
  useEffect(() => {
    if (!peekHint) return
    const PEEK_X = -60
    const delay = setTimeout(() => {
      const el = contentRef.current
      const ac = actionsRef.current
      if (el) el.style.transition = "transform 400ms cubic-bezier(.25,.8,.25,1)"
      if (ac) ac.style.transition = "width 400ms cubic-bezier(.25,.8,.25,1)"
      applyX(PEEK_X)
      const hold = setTimeout(() => {
        if (el) el.style.transition = "transform 500ms cubic-bezier(.25,.8,.25,1)"
        if (ac) ac.style.transition = "width 500ms cubic-bezier(.25,.8,.25,1)"
        applyX(0)
      }, 800)
      return () => clearTimeout(hold)
    }, 600)
    return () => clearTimeout(delay)
  }, [peekHint])

  return (
    <li className="relative overflow-hidden rounded-md">
      {/* Swipe action buttons — iOS-style reveal from right edge */}
      <div
        ref={actionsRef}
        className="absolute right-0 top-0 bottom-0 z-10 overflow-hidden md:hidden"
        style={{ width: 0 }}
      >
        <div className="absolute right-0 top-0 bottom-0 flex" style={{ width: REVEAL_W }}>
        {isConfirming ? (
          <>
            <button type="button" onClick={() => { onDelete(); closeSwipe() }} className="flex w-12 items-center justify-center bg-red-500 text-white active:bg-red-600">
              <Check className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => { onCancelConfirm(); closeSwipe() }} className="flex w-12 items-center justify-center bg-neutral-500 text-white active:bg-neutral-600">
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => { onTogglePin(); closeSwipe() }}
              className={clsx("flex w-12 flex-col items-center justify-center gap-0.5 text-white", isPinned ? "bg-amber-500 active:bg-amber-600" : "bg-blue-500 active:bg-blue-600")}
            >
              <Pin className="h-3.5 w-3.5" />
              <span className="text-[9px] leading-none">{isPinned ? "取消" : "置顶"}</span>
            </button>
            <button
              type="button"
              onClick={() => { onToggleComplete(); closeSwipe() }}
              className={clsx("flex w-12 flex-col items-center justify-center gap-0.5 text-white", isCompleted ? "bg-neutral-500 active:bg-neutral-600" : "bg-emerald-500 active:bg-emerald-600")}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="text-[9px] leading-none">{isCompleted ? "撤销" : "完成"}</span>
            </button>
            <button
              type="button"
              onClick={() => { startEditing(); closeSwipe() }}
              className="flex w-12 flex-col items-center justify-center gap-0.5 bg-amber-500 text-white active:bg-amber-600"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="text-[9px] leading-none">重命名</span>
            </button>
            <button type="button" onClick={() => onConfirm()} className="flex w-12 flex-col items-center justify-center gap-0.5 bg-red-500 text-white active:bg-red-600">
              <Trash2 className="h-3.5 w-3.5" />
              <span className="text-[9px] leading-none">删除</span>
            </button>
          </>
        )}
        </div>
      </div>

      {/* Slideable content */}
      <div
        ref={contentRef}
        className={clsx(
          "group relative rounded-md border-l-2 will-change-transform",
          isActive ? "border-blue-500 bg-elevated" : "border-transparent bg-surface hover:bg-elevated/50",
        )}
        onTouchStart={onTS}
        onTouchMove={onTM}
        onTouchEnd={onTE}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button
          type="button"
          onClick={() => { if (!editing) { onSelect(); closeSwipe() } }}
          className={clsx("block w-full px-2.5 py-2 text-left", isCompleted && !isActive && "opacity-50")}
          style={{ pointerEvents: "auto" }}
        >
          <div className="flex items-center gap-2">
            <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(status))} />
            <span className="min-w-0 truncate font-mono text-xs text-fg-3">{session.agent?.trim() || "默认"}</span>
            {isPinned && <Pin className="h-3 w-3 shrink-0 text-amber-400" />}
            {isCompleted && <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />}
            {when && <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-fg-5">{when}</span>}
          </div>
          {editing ? (
            <input
              ref={editRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit()
                if (e.key === "Escape") setEditing(false)
              }}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 w-full rounded border border-blue-500 bg-base pl-3.5 text-sm text-fg-2 outline-none"
            />
          ) : (
            <div
              className="mt-0.5 pl-3.5"
              onDoubleClick={(e) => { e.stopPropagation(); startEditing() }}
            >
              {(issue || linkedItems) && (
                <div className="mb-0.5 flex flex-wrap gap-1">
                  {issue && (
                    <span className={clsx(
                      "shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-medium leading-none",
                      issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
                    )}>
                      #{issue.number}
                    </span>
                  )}
                  {linkedItems?.map((item) => (
                    <span
                      key={`${item.type}-${item.number}`}
                      className={clsx(
                        "shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-medium leading-none",
                        item.type === "pr"
                          ? item.state === "open" ? "bg-blue-500/15 text-blue-400"
                            : item.mergedAt ? "bg-purple-500/15 text-purple-400"
                            : "bg-red-500/15 text-red-400"
                          : item.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
                      )}
                    >
                      {item.type === "pr" ? `PR#${item.number}` : `#${item.number}`}
                    </span>
                  ))}
                </div>
              )}
              <span className="block truncate text-sm text-fg-2">{session.title?.trim() || "未命名运行"}</span>
              {draft && (
                <span className="mt-0.5 block truncate text-xs text-amber-400/80">
                  ✏️ {draft}
                </span>
              )}
              {todos.length > 0 && (() => {
                const total = todos.length
                const completed = countCompletedTodos(todos)
                return (
                  <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px]">
                    <span className="shrink-0 tracking-tight">
                      {todos.map((todo) => {
                        const s = normalizeTodoStatus(todo.status)
                        return (
                          <span
                            key={todo.id}
                            className={
                              s === "completed" ? "text-emerald-400"
                                : s === "in_progress" ? "text-amber-400"
                                : s === "cancelled" ? "text-fg-6"
                                : "text-fg-5"
                            }
                          >
                            {s === "pending" ? "□" : "■"}
                          </span>
                        )
                      })}
                    </span>
                    <span className="tabular-nums text-fg-4">{completed}/{total}</span>
                  </span>
                )
              })()}
            </div>
          )}
        </button>

        {/* Desktop hover buttons */}
        {isConfirming ? (
          <span className="absolute right-1.5 top-1.5 hidden items-center gap-1 rounded bg-surface/90 px-0.5 md:flex">
            <button type="button" onClick={onDelete} className="rounded p-1 text-red-400 hover:bg-red-500/10"><Check className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={onCancelConfirm} className="rounded p-1 text-fg-3 hover:bg-elevated"><X className="h-3.5 w-3.5" /></button>
          </span>
        ) : (
          <span className="absolute right-1.5 top-1.5 hidden items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 md:flex">
            <button
              type="button"
              onClick={onTogglePin}
              title={isPinned ? "取消置顶" : "置顶"}
              className={clsx("rounded p-1", isPinned ? "text-amber-400 hover:text-amber-300" : "text-fg-5 hover:text-amber-400")}
            >
              <Pin className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleComplete}
              title={isCompleted ? "取消完成" : "标记完成"}
              className={clsx("rounded p-1", isCompleted ? "text-emerald-400 hover:text-emerald-300" : "text-fg-5 hover:text-emerald-400")}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={startEditing}
              title="重命名"
              className="rounded p-1 text-fg-5 hover:text-fg-2"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                copyText(JSON.stringify({ id: session.id, name: session.title?.trim() || "" }, null, 2))
              }}
              title="复制 Session JSON"
              className="rounded p-1 text-fg-5 hover:text-fg-2"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onConfirm} className="rounded p-1 text-fg-5 hover:text-red-400">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>

      {/* Long-press context menu (mobile) */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setCtxMenu(null)} onTouchEnd={() => setCtxMenu(null)} />
          <div
            className="fixed z-50 min-w-[160px] rounded-lg border border-line bg-surface py-1 shadow-xl"
            style={{ left: Math.min(ctxMenu.x, window.innerWidth - 176), top: ctxMenu.y, animation: "ctx-fade-in 150ms ease-out" }}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-fg-2 active:bg-elevated"
              onClick={() => {
                copyText(JSON.stringify({ id: session.id, name: session.title?.trim() || "" }, null, 2))
                setCtxMenu(null)
              }}
            >
              <Copy className="h-3.5 w-3.5 text-fg-5" />
              复制 Session JSON
            </button>
          </div>
        </>
      )}
    </li>
  )
}

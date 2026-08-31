import { useEffect, useRef, useState } from "react"
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, Pencil, Plus, Trash2, X } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import clsx from "clsx"
import type { Session, Todo } from "../lib/api-client"
import { useSessionStore, EMPTY_TODOS, EMPTY_MESSAGES } from "../stores/session-store"
import { countCompletedTodos, normalizeTodoStatus } from "../lib/message-parts"
import { useRepoStore } from "../stores/repo-store"
import { useIssueStore } from "../stores/issue-store"
import { useDraftStore } from "../stores/draft-store"
import { useLayoutStore } from "../stores/layout-store"
import { RunView } from "../components/RunView"
import { SidePanel, type PreviewFileInfo } from "../components/SidePanel"
import { useSwipeDrawer } from "../hooks/use-swipe-drawer"
import { SwipeDrawer } from "../components/SwipeDrawer"


function sessionTime(session: Session): number {
  if (typeof session.time?.updated === "number") return session.time.updated
  if (typeof session.time?.created === "number") return session.time.created
  if (session.createdAt) {
    const parsed = Date.parse(session.createdAt)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

function formatWhen(session: Session): string {
  const raw = sessionTime(session)
  if (!raw) return ""
  const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw
  const date = new Date(ms)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function copyText(text: string) {
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
  } else {
    fallbackCopy(text)
  }
}
function fallbackCopy(text: string) {
  const ta = document.createElement("textarea")
  ta.value = text
  ta.style.cssText = "position:fixed;opacity:0"
  document.body.appendChild(ta)
  ta.select()
  document.execCommand("copy")
  document.body.removeChild(ta)
}

function statusDotClass(status: string | undefined): string {
  switch (status) {
    case "idle": return "bg-emerald-500"
    case "busy": case "retry": return "bg-amber-500 animate-pulse"
    case "error": return "bg-red-500"
    default: return "bg-fg-5"
  }
}

const SWIPE_HINT_KEY = "fs:swipe-hint-shown"

function SessionItem({
  session, isActive, isConfirming, peekHint,
  onSelect, onDelete, onConfirm, onCancelConfirm, onRename, onToggleComplete,
  status, issue, linkedItems, todos,
}: {
  session: Session; isActive: boolean; isConfirming: boolean; peekHint?: boolean
  onSelect: () => void; onDelete: () => void; onConfirm: () => void; onCancelConfirm: () => void
  onRename: (title: string) => void; onToggleComplete: () => void
  status: string | undefined
  issue?: { number: number; title: string; state: string }
  linkedItems?: Array<{ number: number; state: string; type: "issue" | "pr"; mergedAt?: number | null }>
  todos: readonly Todo[]
}) {
  const draft = useDraftStore((s) => s.drafts[session.id])
  const isCompleted = !!session.completedAt
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
  const REVEAL_W = 144
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

function SessionPanel({ onClose }: { onClose?: () => void }) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [showPeekHint] = useState(() => {
    if (typeof window === "undefined") return false
    if (localStorage.getItem(SWIPE_HINT_KEY)) return false
    localStorage.setItem(SWIPE_HINT_KEY, "1")
    return true
  })

  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const statuses = useSessionStore((s) => s.sessionStatuses)
  const sessionFilter = useSessionStore((s) => s.sessionFilter)
  const setSessionFilter = useSessionStore((s) => s.setSessionFilter)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const toggleSessionComplete = useSessionStore((s) => s.toggleSessionComplete)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const issues = useIssueStore((s) => s.issues)
  const allSessionLinks = useSessionStore((s) => s.allSessionLinks)
  const allTodos = useSessionStore((s) => s.todos)

  const topLevel = [...sessions]
    .filter((s) => {
      if (s.parentID) return false
      if (sessionFilter === "active") return !s.completedAt
      return true
    })
    .sort((a, b) => sessionTime(b) - sessionTime(a))

  const issueMap = new Map(issues.map((i) => [i.id, i]))
  const renderSessionList = (list: Session[]) => (
    <ul className="space-y-0.5">
      {list.map((session, idx) => {
        const linkedIssue = session.issueId ? issueMap.get(session.issueId) : undefined
        const sLinks = allSessionLinks[session.id]
        const linkedItems: Array<{ number: number; state: string; type: "issue" | "pr"; mergedAt?: number | null }> = []
        if (sLinks) {
          for (const i of sLinks.issues) linkedItems.push({ number: i.number, state: i.state, type: "issue" })
          for (const p of sLinks.pullRequests) linkedItems.push({ number: p.number, state: p.state, type: "pr", mergedAt: p.mergedAt })
        }
        return (
          <SessionItem
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            isConfirming={confirmingId === session.id}
            peekHint={showPeekHint && idx === 0}
            status={statuses[session.id]}
            issue={linkedIssue ? { number: linkedIssue.number, title: linkedIssue.title, state: linkedIssue.state } : undefined}
            linkedItems={linkedItems.length > 0 ? linkedItems : undefined}
            onSelect={() => { void setActiveSession(session.id); onClose?.() }}
            onDelete={() => { void deleteSession(session.id); setConfirmingId(null) }}
            onConfirm={() => setConfirmingId(session.id)}
            onCancelConfirm={() => setConfirmingId(null)}
            onRename={(title) => void renameSession(session.id, title)}
            onToggleComplete={() => void toggleSessionComplete(session.id)}
            todos={allTodos[session.id] ?? EMPTY_TODOS}
          />
        )
      })}
    </ul>
  )

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-line px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">运行记录</span>
          {activeRepoId && (
            <button
              type="button"
              onClick={() => { useSessionStore.setState({ activeSessionId: null }); onClose?.() }}
              title="新建运行"
              className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-white transition-colors hover:bg-blue-500"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
        {activeRepoId && (
          <div className="flex gap-1 border-b border-line px-3 py-1.5">
            {([["active", "进行中"], ["all", "全部"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSessionFilter(key)}
                className={clsx(
                  "rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors",
                  sessionFilter === key ? "bg-elevated text-fg-2" : "text-fg-5 hover:text-fg-3",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {!activeRepoId ? (
            <p className="px-2 py-6 text-center font-mono text-xs text-fg-5">请先选择一个仓库</p>
          ) : topLevel.length === 0 ? (
            <p className="px-2 py-6 text-center font-mono text-xs text-fg-5">暂无运行记录</p>
          ) : (
            <div>
              {renderSessionList(topLevel)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---- Page ---- */

function useIsXl(): boolean {
  const [isXl, setIsXl] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches,
  )
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)")
    const handler = (e: MediaQueryListEvent) => setIsXl(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])
  return isXl
}

function scrollToMessage(messageId: string) {
  const el = document.querySelector(`[data-message-id="${messageId}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: "smooth", block: "center" })
  el.classList.add("fs-highlight")
  setTimeout(() => el.classList.remove("fs-highlight"), 2000)
}

const HTML_PREVIEW_EXTS = new Set([".html", ".htm"])
const MD_PREVIEW_EXT = ".md"

function FilePreviewOverlay({ file, onClose }: { file: PreviewFileInfo; onClose: () => void }) {
  const [textContent, setTextContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose() }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose])

  useEffect(() => {
    if (HTML_PREVIEW_EXTS.has(file.ext)) return
    setLoading(true)
    fetch(file.url)
      .then((r) => r.text())
      .then((t) => setTextContent(t))
      .catch(() => setTextContent("加载失败"))
      .finally(() => setLoading(false))
  }, [file.url, file.ext])

  let content: React.ReactNode
  if (HTML_PREVIEW_EXTS.has(file.ext)) {
    content = (
      <iframe
        src={file.url}
        sandbox=""
        title={file.name}
        className="h-full w-full border-0 bg-white"
      />
    )
  } else if (loading) {
    content = <p className="p-8 text-center font-mono text-sm text-fg-5">加载中…</p>
  } else if (file.ext === MD_PREVIEW_EXT) {
    content = (
      <div className="prose prose-invert max-w-none overflow-y-auto p-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{textContent ?? ""}</ReactMarkdown>
      </div>
    )
  } else {
    content = (
      <pre className="h-full overflow-auto whitespace-pre-wrap p-6 font-mono text-xs leading-relaxed text-fg-2">
        {textContent}
      </pre>
    )
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-base/95 backdrop-blur-sm">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
        <span className="min-w-0 truncate font-mono text-sm text-fg-2">{file.name}</span>
        <span className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">{file.ext}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  )
}

export function RunPage() {
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState<PreviewFileInfo | null>(null)

  const isXl = useIsXl()
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  useEffect(() => { setPreviewFile(null) }, [activeSessionId])
  const sessionPanelCollapsed = useLayoutStore((s) => s.sessionPanelCollapsed)
  const toggleSessionPanel = useLayoutStore((s) => s.toggleSessionPanel)
  const todos = useSessionStore((s) => {
    const id = s.activeSessionId
    return id ? (s.todos[id] ?? EMPTY_TODOS) : EMPTY_TODOS
  })
  const messages = useSessionStore((s) => {
    const id = s.activeSessionId
    return id ? (s.messages[id] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES
  })
  const sessionLinks = useSessionStore((s) => {
    const id = s.activeSessionId
    return id ? s.sessionLinks[id] : undefined
  })

  useEffect(() => {
    if (isXl && activeSessionId) {
      setSidePanelOpen(true)
    } else if (!isXl) {
      setSidePanelOpen(false)
    }
  }, [isXl, activeSessionId])

  const desktopSidePanelVisible = sidePanelOpen && !!activeSessionId

  const toggleRightPanel = () => {
    if (window.matchMedia("(max-width: 767px)").matches) {
      setRightOpen((v) => !v)
    } else {
      setSidePanelOpen((v) => !v)
    }
  }

  const swipeHandlers = useSwipeDrawer({
    onSwipeRight: () => setLeftOpen(true),
    onSwipeLeft: () => setRightOpen(true),
    disabled: leftOpen || rightOpen,
  })

  return (
    <div className="flex min-h-0 flex-1" {...swipeHandlers}>
      {/* Desktop left sidebar — collapsible at md+ */}
      <div className="relative hidden shrink-0 md:flex">
        <div
          className={clsx(
            "overflow-hidden transition-[width] duration-200 ease-in-out",
            sessionPanelCollapsed ? "w-0" : "w-80",
          )}
        >
          <div className="h-full w-80">
            <SessionPanel />
          </div>
        </div>
        {/* Edge toggle handle — vertical tab on the panel/content boundary */}
        <button
          type="button"
          onClick={toggleSessionPanel}
          title={sessionPanelCollapsed ? "展开运行记录" : "收起运行记录"}
          className={clsx(
            "absolute left-full top-1/2 z-20 flex h-14 w-4 -translate-y-1/2 items-center justify-center rounded-r-md border-y border-r border-line text-fg-5 transition-all duration-200 hover:bg-elevated hover:text-fg-3",
            sessionPanelCollapsed
              ? "bg-surface opacity-80 hover:w-5 hover:opacity-100"
              : "bg-surface/80 opacity-40 hover:opacity-100",
          )}
        >
          {sessionPanelCollapsed
            ? <ChevronRight className="h-3 w-3" />
            : <ChevronLeft className="h-3 w-3" />
          }
        </button>
      </div>

      {/* Mobile left drawer — Session list */}
      <SwipeDrawer side="left" open={leftOpen} onClose={() => setLeftOpen(false)}>
        <SessionPanel onClose={() => setLeftOpen(false)} />
      </SwipeDrawer>

      {/* Mobile right drawer — SidePanel (Todo + Prompts) */}
      <SwipeDrawer side="right" open={rightOpen} onClose={() => setRightOpen(false)}>
        <SidePanel
          todos={todos}
          messages={messages}
          sessionLinks={sessionLinks}
          sessionId={activeSessionId}
          onScrollToMessage={(id) => { setRightOpen(false); setTimeout(() => scrollToMessage(id), 300) }}
        />
      </SwipeDrawer>

      {/* Main content */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <RunView
          onToggleSidebar={() => setLeftOpen((v) => !v)}
          onToggleRightPanel={toggleRightPanel}
          rightPanelOpen={desktopSidePanelVisible}
        />
        {previewFile && (
          <FilePreviewOverlay file={previewFile} onClose={() => setPreviewFile(null)} />
        )}
      </div>

      {/* Desktop right sidebar — SidePanel (Todo + Prompts) */}
      {desktopSidePanelVisible && (
        <div className="hidden shrink-0 md:flex">
          <SidePanel
            todos={todos}
            messages={messages}
            sessionLinks={sessionLinks}
            sessionId={activeSessionId}
            onScrollToMessage={scrollToMessage}
            onPreviewFile={setPreviewFile}
          />
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from "react"
import { ArrowRight, ChevronRight } from "lucide-react"
import clsx from "clsx"
import type { MessagePart } from "../lib/api-client"
import {
  extractTaskSessionId,
  formatToolPayload,
  getToolInput,
  getToolName,
  getToolOutput,
  getToolStatus,
  type ToolStatus,
} from "../lib/message-parts"
import { useSessionStore } from "../stores/session-store"

const OUTPUT_TRUNCATE_LIMIT = 2000

const TOOL_LABELS: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  patch: "Patch",
  grep: "Grep",
  glob: "Glob",
  bash: "Bash",
  shell: "Bash",
  list: "List",
  ls: "List",
  webfetch: "Fetch",
  fetch: "Fetch",
  task: "Task",
  agent: "Task",
  todowrite: "Todo",
  write_todos: "Todo",
  question: "Question",
  mcp_question: "Question",
}

const STATUS_META: Record<
  ToolStatus,
  { glyph: string; label: string; color: string; accent: string; spin: boolean }
> = {
  running: {
    glyph: "◌",
    label: "running",
    color: "text-amber-400",
    accent: "border-amber-500/40",
    spin: true,
  },
  completed: {
    glyph: "✓",
    label: "done",
    color: "text-emerald-400",
    accent: "border-emerald-500/40",
    spin: false,
  },
  error: {
    glyph: "✗",
    label: "error",
    color: "text-red-400",
    accent: "border-red-500/40",
    spin: false,
  },
  pending: {
    glyph: "○",
    label: "queued",
    color: "text-fg-4",
    accent: "border-fg-6",
    spin: false,
  },
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function firstString(
  record: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!record) {
    return null
  }
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim()
    }
  }
  return null
}

function describeTool(
  name: string,
  input: unknown,
): { label: string; arg: string | null } {
  const lower = name.toLowerCase()
  const label = TOOL_LABELS[lower] ?? name.charAt(0).toUpperCase() + name.slice(1)
  const record = toRecord(input)

  switch (lower) {
    case "read":
    case "write":
    case "edit":
    case "patch":
      return { label, arg: firstString(record, ["filePath", "path", "file"]) }
    case "grep": {
      const pattern = firstString(record, ["pattern", "query"])
      return { label, arg: pattern ? `"${pattern}"` : null }
    }
    case "glob":
      return { label, arg: firstString(record, ["pattern", "query"]) }
    case "bash":
    case "shell": {
      const command = firstString(record, ["command", "cmd", "script"])
      return { label, arg: command ? command.split("\n")[0] : null }
    }
    case "webfetch":
    case "fetch":
      return { label, arg: firstString(record, ["url"]) }
    case "task":
    case "agent":
      return { label, arg: firstString(record, ["description", "prompt", "title"]) }
    default:
      return {
        label,
        arg: firstString(record, [
          "filePath",
          "path",
          "pattern",
          "query",
          "command",
          "url",
          "description",
        ]),
      }
  }
}

function DiffView({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const oldLines = oldStr.split("\n")
  const newLines = newStr.split("\n")
  return (
    <div className="grid grid-cols-1 gap-px overflow-x-auto rounded text-xs md:grid-cols-2">
      <pre className="min-w-0 whitespace-pre-wrap break-words p-1.5 fs-diff-del">
        {oldLines.map((line, i) => (
          <div key={i}>
            <span className="select-none text-red-400/70">− </span>
            <span className="text-red-400">{line}</span>
          </div>
        ))}
      </pre>
      <pre className="min-w-0 whitespace-pre-wrap break-words p-1.5 fs-diff-add">
        {newLines.map((line, i) => (
          <div key={i}>
            <span className="select-none text-emerald-400/70">+ </span>
            <span className="text-emerald-400">{line}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}

const TODO_GLYPHS: Record<string, { glyph: string; color: string }> = {
  completed: { glyph: "✓", color: "text-emerald-400" },
  in_progress: { glyph: "◌", color: "text-amber-400" },
  cancelled: { glyph: "✗", color: "text-fg-5" },
  pending: { glyph: "○", color: "text-fg-4" },
}

function TodoView({ todos }: { todos: Array<{ content: string; status: string; priority?: string }> }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {todos.map((todo, i) => {
        const st = todo.status?.toLowerCase() ?? "pending"
        const normalized = st === "in-progress" || st === "active" ? "in_progress"
          : st === "done" || st === "complete" ? "completed"
          : st === "canceled" ? "cancelled"
          : st
        const meta = TODO_GLYPHS[normalized] ?? TODO_GLYPHS.pending
        const done = normalized === "completed" || normalized === "cancelled"
        return (
          <li key={i} className="flex items-start gap-1.5">
            <span className={clsx("shrink-0 leading-5", meta.color, normalized === "in_progress" && "fs-spin")}>
              {meta.glyph}
            </span>
            <span className={clsx("leading-5", done ? "text-fg-5 line-through" : "text-fg-2")}>
              {todo.content}
            </span>
            {todo.priority && (
              <span className="ml-auto shrink-0 text-fg-5">{todo.priority}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const CATEGORY_COLORS: Record<string, string> = {
  "visual-engineering": "bg-purple-500/15 text-purple-400",
  quick: "bg-emerald-500/15 text-emerald-400",
  deep: "bg-blue-500/15 text-blue-400",
  ultrabrain: "bg-amber-500/15 text-amber-400",
  artistry: "bg-pink-500/15 text-pink-400",
  writing: "bg-cyan-500/15 text-cyan-400",
  "unspecified-low": "bg-elevated text-fg-4",
  "unspecified-high": "bg-elevated text-fg-3",
}

const SUBAGENT_COLORS: Record<string, string> = {
  explore: "bg-teal-500/15 text-teal-400",
  librarian: "bg-indigo-500/15 text-indigo-400",
  oracle: "bg-amber-500/15 text-amber-400",
  metis: "bg-rose-500/15 text-rose-400",
  momus: "bg-orange-500/15 text-orange-400",
}

function TaskInputView({ record }: { record: Record<string, unknown> }) {
  const [promptOpen, setPromptOpen] = useState(false)

  const category = typeof record.category === "string" ? record.category : null
  const subagentType = typeof record.subagent_type === "string" ? record.subagent_type : null
  const description = firstString(record, ["description", "title"])
  const prompt = typeof record.prompt === "string" ? record.prompt : null
  const skills = Array.isArray(record.load_skills) ? record.load_skills.filter((s): s is string => typeof s === "string") : []
  const bg = typeof record.run_in_background === "boolean" ? record.run_in_background : false
  const taskId = typeof record.task_id === "string" ? record.task_id : null

  const typeLabel = category ?? subagentType
  const typeColor = (category && CATEGORY_COLORS[category]) ?? (subagentType && SUBAGENT_COLORS[subagentType]) ?? "bg-elevated text-fg-3"

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {typeLabel && (
          <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-medium", typeColor)}>
            {typeLabel}
          </span>
        )}
        {skills.map((s) => (
          <span key={s} className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-fg-4">{s}</span>
        ))}
        {bg && (
          <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-fg-5">bg</span>
        )}
        {taskId && (
          <span className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5" title={taskId}>
            ↩ {taskId.slice(0, 16)}…
          </span>
        )}
      </div>

      {description && (
        <p className="text-xs text-fg-2">{description}</p>
      )}

      {prompt && (
        <div>
          <button
            type="button"
            onClick={() => setPromptOpen((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-fg-4 transition-colors hover:text-fg-2"
          >
            <ChevronRight className={clsx("h-3 w-3 transition-transform", promptOpen && "rotate-90")} />
            Prompt
            <span className="text-fg-5">({prompt.length} chars)</span>
          </button>
          {promptOpen && (
            <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded bg-elevated/50 p-2 text-[11px] leading-relaxed text-fg-3">
              {prompt}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function useChildSessionId(part: MessagePart): string | null {
  const fromPart = extractTaskSessionId(part)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sessions = useSessionStore((s) => s.sessions)

  if (fromPart) return fromPart

  // Fallback: find child session by parentID when metadata/output not yet available
  if (!activeSessionId) return null
  const input = getToolInput(part)
  const record = toRecord(input)
  const description = firstString(record, ["description", "title"])

  const children = sessions.filter((s) => s.parentID === activeSessionId)
  if (children.length === 0) return null
  if (children.length === 1) return children[0].id

  // Multiple children: match by description → session title
  if (description) {
    const match = children.find((s) => s.title === description)
    if (match) return match.id
  }
  return null
}

function TaskSessionLink({ part }: { part: MessagePart }) {
  const resolvedId = useChildSessionId(part)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)

  if (!resolvedId) return null

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        void setActiveSession(resolvedId)
      }}
      className="mt-2 flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 font-mono text-xs text-blue-400 transition-colors hover:border-blue-500/50 hover:bg-blue-500/10"
    >
      <span className="truncate text-fg-5">{resolvedId.slice(0, 20)}…</span>
      <ArrowRight className="h-3 w-3 shrink-0" />
      <span className="shrink-0">查看子会话</span>
    </button>
  )
}

function renderToolInput(name: string, raw: unknown): React.ReactNode | null {
  const record = toRecord(raw)
  if (!record) return null
  const lower = name.toLowerCase()

  if (lower === "edit" || lower === "patch") {
    const oldStr = typeof record.oldString === "string" ? record.oldString : ""
    const newStr = typeof record.newString === "string" ? record.newString : ""
    if (oldStr || newStr) {
      return <DiffView oldStr={oldStr} newStr={newStr} />
    }
  }

  if (lower === "todowrite" || lower === "write_todos") {
    const todos = Array.isArray(record.todos) ? record.todos as Array<{ content: string; status: string; priority?: string }> : null
    if (todos && todos.length > 0) {
      return <TodoView todos={todos} />
    }
  }

  if (lower === "bash" || lower === "shell") {
    const cmd = firstString(record, ["command", "cmd", "script"])
    if (cmd) {
      return (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words text-fg-2">
          <span className="select-none text-emerald-400/70">❯ </span>{cmd}
        </pre>
      )
    }
  }

  if (lower === "task" || lower === "agent") {
    return <TaskInputView record={record} />
  }

  if (lower === "read") {
    return null
  }

  if (lower === "write") {
    const content = typeof record.content === "string" ? record.content : null
    if (content) {
      const preview = content.length > 500 ? `${content.slice(0, 500)}…` : content
      return (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words text-fg-2">
          {preview}
        </pre>
      )
    }
  }

  return null
}

function renderToolOutput(name: string, raw: unknown): React.ReactNode | null {
  const lower = name.toLowerCase()

  if (lower === "todowrite" || lower === "write_todos") {
    const list = Array.isArray(raw) ? raw as Array<{ content: string; status: string; priority?: string }> : null
    if (list && list.length > 0) {
      return <TodoView todos={list} />
    }
  }

  return null
}

export function ToolCallPanel({ part }: { part: MessagePart }) {
  const status = getToolStatus(part)
  const active = status === "running" || status === "pending"

  const [open, setOpen] = useState(active)
  const [outputExpanded, setOutputExpanded] = useState(false)
  const wasActive = useRef(active)

  useEffect(() => {
    if (wasActive.current !== active) {
      setOpen(active)
      wasActive.current = active
    }
  }, [active])

  const toolName = getToolName(part)
  const lower = toolName.toLowerCase()
  const isTask = lower === "task" || lower === "agent"
  const rawInput = getToolInput(part)
  const { label, arg } = describeTool(toolName, rawInput)
  const customInput = renderToolInput(toolName, rawInput)
  const fallbackInput = customInput ? null : formatToolPayload(rawInput)
  const rawOutput = getToolOutput(part)
  const customOutput = renderToolOutput(toolName, rawOutput)
  const output = customOutput ? "" : formatToolPayload(rawOutput)
  const meta = STATUS_META[status]

  const outputTooLong = output.length > OUTPUT_TRUNCATE_LIMIT
  const shownOutput =
    outputExpanded || !outputTooLong
      ? output
      : `${output.slice(0, OUTPUT_TRUNCATE_LIMIT)}…`

  return (
    <div className="my-1 overflow-hidden rounded-md border border-line bg-term/70">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs transition-colors duration-150 hover:bg-surface/70"
      >
        <span className={clsx("shrink-0 leading-none", meta.color)}>
          {open ? "▾" : "▸"}
        </span>
        <span className="shrink-0 font-medium text-fg">{label}</span>
        {arg && <span className="truncate text-fg-3">{arg}</span>}
        <span
          className={clsx(
            "ml-auto flex shrink-0 items-center gap-1.5 leading-none",
            meta.color,
          )}
        >
          <span className={clsx(meta.spin && "fs-spin")}>{meta.glyph}</span>
          <span>{meta.label}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-line px-3 py-2">
          <div className={clsx("ml-1 border-l-2 pl-3 font-mono text-xs", meta.accent)}>
            {customInput && (
              <section className="mb-2">{customInput}</section>
            )}
            {fallbackInput && (
              <section className="mb-2">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-5">
                  input
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-fg-2">
                  {fallbackInput}
                </pre>
              </section>
            )}
            {isTask && <TaskSessionLink part={part} />}
            {customOutput && (
              <section>{customOutput}</section>
            )}
            {output && (
              <section>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-5">
                  output
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-fg-2">
                  {shownOutput}
                </pre>
                {outputTooLong && (
                  <button
                    type="button"
                    onClick={() => setOutputExpanded((value) => !value)}
                    className="mt-1 text-blue-400 transition-colors hover:text-blue-300"
                  >
                    {outputExpanded
                      ? "show less"
                      : `show ${output.length - OUTPUT_TRUNCATE_LIMIT} more chars`}
                  </button>
                )}
              </section>
            )}
            {!customInput && !fallbackInput && !customOutput && !output && (
              <div className="text-fg-5">no parameters</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

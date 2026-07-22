import { useEffect, useRef, useState } from "react"
import clsx from "clsx"
import type { MessagePart } from "../lib/api-client"
import {
  formatToolPayload,
  getToolInput,
  getToolName,
  getToolOutput,
  getToolStatus,
  type ToolStatus,
} from "../lib/message-parts"

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

  const { label, arg } = describeTool(getToolName(part), getToolInput(part))
  const input = formatToolPayload(getToolInput(part))
  const output = formatToolPayload(getToolOutput(part))
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
            {input && (
              <section className="mb-2">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-5">
                  input
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-fg-2">
                  {input}
                </pre>
              </section>
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
            {!input && !output && (
              <div className="text-fg-5">no parameters</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

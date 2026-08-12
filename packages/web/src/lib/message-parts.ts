/*
 * Normalization helpers over MessagePart / Todo, isolating the frontend from
 * whether the backend speaks the spec dialect (content/toolName/input/output)
 * or the OpenCode dialect (text/tool/state{status,input,output}).
 */

import type { MessagePart, Todo } from "./api-client"

export type PartKind = "text" | "thinking" | "tool" | "file" | "other"

const TOOL_TYPES = new Set([
  "tool",
  "tool-use",
  "tool_use",
  "tool-call",
  "tool_call",
  "tool-result",
  "tool_result",
])

const THINKING_TYPES = new Set(["thinking", "reasoning", "reason"])

const TEXT_TYPES = new Set(["text", "output_text", "message"])

const FILE_TYPES = new Set(["file", "image"])

/** Classify a part into the five rendering buckets. */
export function classifyPart(part: MessagePart): PartKind {
  const type = part.type?.toLowerCase() ?? ""
  if (TOOL_TYPES.has(type) || part.toolName != null || part.tool != null) {
    return "tool"
  }
  if (FILE_TYPES.has(type)) {
    return "file"
  }
  if (THINKING_TYPES.has(type)) {
    return "thinking"
  }
  if (TEXT_TYPES.has(type) || part.content != null || part.text != null) {
    return "text"
  }
  return "other"
}

/** Text body of a text/thinking part; empty string when absent. */
export function getPartText(part: MessagePart): string {
  return part.content ?? part.text ?? ""
}

export function getToolName(part: MessagePart): string {
  return part.toolName ?? part.tool ?? "tool"
}

export function getToolInput(part: MessagePart): unknown {
  return part.input ?? part.state?.input
}

export function getToolOutput(part: MessagePart): unknown {
  return part.output ?? part.state?.output
}

export type ToolStatus = "pending" | "running" | "completed" | "error"

/**
 * Derive a tool's lifecycle state. Prefers an explicit state.status, then an
 * error signal, then presence of output, falling back to "running".
 */
export function getToolStatus(part: MessagePart): ToolStatus {
  const raw = part.state?.status?.toLowerCase()
  if (raw === "completed" || raw === "done" || raw === "success") {
    return "completed"
  }
  if (raw === "error" || raw === "failed" || part.state?.error != null) {
    return "error"
  }
  if (raw === "pending" || raw === "queued") {
    return "pending"
  }
  if (raw === "running" || raw === "in_progress") {
    return "running"
  }
  return getToolOutput(part) != null ? "completed" : "running"
}

/** Pretty-print a tool payload; strings pass through, objects become JSON. */
export function formatToolPayload(value: unknown): string {
  if (value == null) {
    return ""
  }
  if (typeof value === "string") {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"

export function normalizeTodoStatus(status: string): TodoStatus {
  const value = status?.toLowerCase()
  if (value === "in_progress" || value === "in-progress" || value === "active") {
    return "in_progress"
  }
  if (value === "completed" || value === "done" || value === "complete") {
    return "completed"
  }
  if (value === "cancelled" || value === "canceled") {
    return "cancelled"
  }
  return "pending"
}

export function countCompletedTodos(todos: readonly Todo[]): number {
  return todos.filter((todo) => normalizeTodoStatus(todo.status) === "completed")
    .length
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionData {
  question: string
  header?: string
  options: QuestionOption[]
  multiple?: boolean
}

export function isQuestionTool(part: MessagePart): boolean {
  const name = getToolName(part).toLowerCase()
  return name === "question" || name === "mcp_question"
}

export function getQuestions(part: MessagePart): QuestionData[] | null {
  const input = getToolInput(part)
  if (!input || typeof input !== "object") return null
  const record = input as Record<string, unknown>
  if (Array.isArray(record.questions)) {
    return record.questions as QuestionData[]
  }
  return null
}

export function isQuestionPending(part: MessagePart): boolean {
  if (!isQuestionTool(part)) return false
  const status = getToolStatus(part)
  return status === "pending" || status === "running"
}

const SESSION_ID_RE = /\bses_[a-zA-Z0-9]+/

/**
 * Extract the sub-session ID spawned by a task/agent tool call.
 * Checks three sources in priority order:
 *   1. input.task_id — continuation session
 *   2. state.metadata.session_id — opencode metadata
 *   3. output text — regex match for ses_xxx pattern
 */
export function extractTaskSessionId(part: MessagePart): string | null {
  // 1. input.task_id (continuation)
  const input = getToolInput(part)
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>
    if (typeof record.task_id === "string" && record.task_id.startsWith("ses_")) {
      return record.task_id
    }
  }

  // 2. state.metadata.session_id
  const meta = part.state?.metadata
  if (meta) {
    const sid = meta.session_id ?? meta.sessionId
    if (typeof sid === "string" && sid.startsWith("ses_")) {
      return sid
    }
  }

  // 3. output text — regex fallback
  const output = getToolOutput(part)
  if (typeof output === "string") {
    const match = SESSION_ID_RE.exec(output)
    if (match) return match[0]
  }
  if (output && typeof output === "object") {
    const rec = output as Record<string, unknown>
    const sid = rec.session_id ?? rec.sessionId ?? rec.task_id
    if (typeof sid === "string" && sid.startsWith("ses_")) {
      return sid
    }
  }

  return null
}

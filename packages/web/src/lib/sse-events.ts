/*
 * SSE payload extraction + dispatch. Tolerates two framings:
 *   1. OpenCode event bus: unnamed "message" events whose JSON carries a
 *      discriminating `type` and a `properties` envelope.
 *   2. Named SSE events (event: message.updated \n data: {...}).
 * Either way we resolve a canonical event name and pull typed data out of it.
 */

import type { Message, MessagePart, Todo } from "./api-client"

export const KNOWN_SSE_EVENTS = [
  "message.updated",
  "message.part.updated",
  "message.part.delta",
  "message.removed",
  "todo.updated",
  "session.status",
  "session.idle",
  "session.error",
  "session.updated",
] as const

export interface SseDispatchTarget {
  updateMessage: (sessionId: string, message: Message) => void
  updateMessagePart: (
    sessionId: string,
    messageId: string,
    part: MessagePart,
  ) => void
  updateTodos: (sessionId: string, todos: Todo[]) => void
  setSessionStatus: (sessionId: string, status: string) => void
}

export function parseEventData(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    return undefined
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null
}

/** Unwrap an OpenCode `{ type, properties }` envelope to its payload. */
function getProps(data: unknown): unknown {
  const record = asRecord(data)
  if (record && "properties" in record) {
    return record.properties
  }
  return data
}

function readType(data: unknown): string | undefined {
  const record = asRecord(data)
  return typeof record?.type === "string" ? record.type : undefined
}

function extractMessage(data: unknown): Message | null {
  const props = asRecord(getProps(data))
  if (!props) {
    return null
  }
  const info = asRecord(props.info)
  if (info && typeof info.id === "string") {
    const parts = Array.isArray(props.parts) ? (props.parts as MessagePart[]) : undefined
    return { ...(info as unknown as Message), ...(parts ? { parts } : {}) }
  }
  if (typeof props.id === "string" && typeof props.role === "string") {
    return props as unknown as Message
  }
  const nested = asRecord(props.message)
  if (nested && typeof nested.id === "string") {
    return nested as unknown as Message
  }
  return null
}

function extractPart(
  data: unknown,
): { messageId?: string; part?: MessagePart } {
  const props = asRecord(getProps(data))
  if (!props) {
    return {}
  }
  const candidate = asRecord(props.part) ?? props
  if (typeof candidate.type !== "string") {
    return {}
  }
  const messageId =
    (typeof candidate.messageID === "string" && candidate.messageID) ||
    (typeof candidate.messageId === "string" && candidate.messageId) ||
    (typeof props.messageID === "string" && props.messageID) ||
    (typeof props.messageId === "string" && props.messageId) ||
    undefined
  return { messageId, part: candidate as unknown as MessagePart }
}

function extractTodos(data: unknown): Todo[] {
  const props = getProps(data)
  if (Array.isArray(props)) {
    return props as Todo[]
  }
  const record = asRecord(props)
  if (record && Array.isArray(record.todos)) {
    return record.todos as Todo[]
  }
  return []
}

function extractStatus(data: unknown): string | null {
  const props = getProps(data)
  if (typeof props === "string") {
    return props
  }
  const record = asRecord(props)
  if (typeof record?.status === "string") {
    return record.status
  }
  const statusObj = asRecord(record?.status)
  if (typeof statusObj?.type === "string") {
    return statusObj.type
  }
  if (typeof record?.type === "string") {
    return record.type
  }
  return null
}

export function dispatchSseEvent(
  name: string,
  data: unknown,
  sessionId: string,
  target: SseDispatchTarget,
): void {
  const resolved = name === "message" || name === "" ? readType(data) ?? name : name
  switch (resolved) {
    case "message.updated":
    case "session.updated": {
      const message = extractMessage(data)
      if (message) {
        target.updateMessage(sessionId, message)
      }
      break
    }
    case "message.part.updated":
    case "message.part.delta": {
      const { messageId, part } = extractPart(data)
      if (part && messageId) {
        target.updateMessagePart(sessionId, messageId, part)
      }
      break
    }
    case "todo.updated": {
      target.updateTodos(sessionId, extractTodos(data))
      break
    }
    case "session.status": {
      const status = extractStatus(data)
      if (status) {
        target.setSessionStatus(sessionId, status)
      }
      break
    }
    case "session.idle": {
      target.setSessionStatus(sessionId, "idle")
      break
    }
    case "session.error": {
      target.setSessionStatus(sessionId, "error")
      break
    }
    default:
      break
  }
}

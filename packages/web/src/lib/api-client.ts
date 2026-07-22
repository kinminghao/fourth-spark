/*
 * API client for the Fourth Spark backend (mounted under /api/*, proxied by Vite).
 *
 * The backend returns OpenCode-shaped data. Types here carry the fields named in
 * the frontend spec PLUS the optional OpenCode-native fields, so rendering stays
 * correct whether the server sends `content` or `text`, `toolName` or `tool`, a
 * flat `input`/`output` or a nested `state`. Normalization lives in message-parts.ts.
 */

export type SessionStatusValue = "idle" | "busy" | "retry"

export interface Session {
  id: string
  title?: string
  agent?: string
  createdAt?: string
  // OpenCode-native compatibility fields.
  time?: { created?: number; updated?: number }
  parentID?: string
}

export interface ToolState {
  status?: string
  input?: unknown
  output?: unknown
  title?: string
  error?: string
  metadata?: Record<string, unknown>
  time?: { start?: number; end?: number }
}

export interface MessagePart {
  type: string
  id?: string
  // Text / thinking content — spec uses `content`, OpenCode uses `text`.
  content?: string
  text?: string
  // Tool fields — spec uses toolName/input/output, OpenCode uses tool + state{}.
  toolName?: string
  tool?: string
  callID?: string
  input?: unknown
  output?: unknown
  state?: ToolState
}

export interface Message {
  id: string
  role: string
  parts?: MessagePart[]
  info?: { agent?: string; modelID?: string; providerID?: string }
  // OpenCode-native compatibility fields.
  sessionID?: string
  time?: { created?: number; completed?: number }
  agent?: string
  modelID?: string
  providerID?: string
}

export interface Todo {
  id: string
  content: string
  status: string
  priority?: string
}

export interface Agent {
  id: string
  name: string
  description?: string
}

export interface SessionStatus {
  type: SessionStatusValue
}

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    })
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? cause.message : "Network request failed",
      0,
    )
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new ApiError(
      body.trim() || `${response.status} ${response.statusText}`,
      response.status,
    )
  }

  if (response.status === 204) {
    return undefined as T
  }

  const raw = await response.text()
  if (!raw) {
    return undefined as T
  }
  return JSON.parse(raw) as T
}

/**
 * Backends sometimes wrap list payloads in an envelope ({ sessions: [...] },
 * { data: [...] }, { items: [...] }). Accept either an array or a single-key
 * envelope so the client survives minor contract drift.
 */
function unwrapList<T>(payload: unknown, ...keys: string[]): T[] {
  if (Array.isArray(payload)) {
    return payload as T[]
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>
    for (const key of [...keys, "data", "items"]) {
      if (Array.isArray(record[key])) {
        return record[key] as T[]
      }
    }
  }
  return []
}

export async function listSessions(): Promise<Session[]> {
  return unwrapList<Session>(await apiFetch<unknown>("/api/sessions"), "sessions")
}

export async function createSession(
  message: string,
  agent?: string,
  model?: string,
  variant?: string,
): Promise<Session> {
  return apiFetch<Session>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ message, agent, model, variant }),
  })
}

export async function getSession(id: string): Promise<Session> {
  return apiFetch<Session>(`/api/sessions/${encodeURIComponent(id)}`)
}

export async function deleteSession(id: string): Promise<void> {
  await apiFetch<void>(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function sendMessage(
  sessionId: string,
  content: string,
): Promise<void> {
  await apiFetch<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/prompt`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
  )
}

export async function abortSession(sessionId: string): Promise<void> {
  await apiFetch<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/abort`,
    { method: "POST" },
  )
}

function normalizeMessage(raw: unknown): Message {
  const r = raw as Record<string, unknown>
  const info = r.info as Record<string, unknown> | undefined
  if (info && typeof info.id === "string") {
    const parts = Array.isArray(r.parts) ? (r.parts as MessagePart[]) : undefined
    return { ...(info as unknown as Message), ...(parts ? { parts } : {}) }
  }
  return r as unknown as Message
}

export async function getMessages(sessionId: string): Promise<Message[]> {
  const raw = unwrapList<unknown>(
    await apiFetch<unknown>(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    ),
    "messages",
  )
  return raw.map(normalizeMessage)
}

export async function getTodos(sessionId: string): Promise<Todo[]> {
  return unwrapList<Todo>(
    await apiFetch<unknown>(
      `/api/sessions/${encodeURIComponent(sessionId)}/todos`,
    ),
    "todos",
  )
}

export async function getSessionStatus(
  sessionId: string,
): Promise<SessionStatus> {
  return apiFetch<SessionStatus>(
    `/api/sessions/${encodeURIComponent(sessionId)}/status`,
  )
}

export async function listAgents(): Promise<Agent[]> {
  return unwrapList<Agent>(await apiFetch<unknown>("/api/agents"), "agents")
}

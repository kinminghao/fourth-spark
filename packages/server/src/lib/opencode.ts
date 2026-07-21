import { OPENCODE_URL, WORKSPACE_DIR } from "./config"

// ---------------------------------------------------------------------------
// Types — the frontend-facing contract. OpenCode responses are forwarded
// verbatim and typed as these shapes (boundary trust: OpenCode is a local,
// controlled process). No validation lib is used per project constraints.
// ---------------------------------------------------------------------------

export type Session = {
  id: string
  title?: string
  parentID?: string
  createdAt?: string
  updatedAt?: string
}

export type MessagePart = {
  type: string
  content?: string
  toolName?: string
  input?: unknown
  output?: unknown
}

export type Message = {
  id: string
  role: string
  parts?: MessagePart[]
  info?: { agent?: string; providerID?: string; modelID?: string }
}

export type Todo = {
  id: string
  content: string
  status: string
  priority?: string
}

export type Agent = {
  id: string
  name: string
  description?: string
}

export type SessionStatus = { type: "idle" | "busy" | "retry" }

export class OpenCodeError extends Error {
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = "OpenCodeError"
    this.status = status
    this.body = body
  }
}

// ---------------------------------------------------------------------------
// Low-level fetch helpers
// ---------------------------------------------------------------------------

type Query = Record<string, string | undefined>

function buildUrl(path: string, query?: Query): string {
  const url = new URL(path, OPENCODE_URL)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

async function ensureOk(res: Response, method: string, path: string): Promise<void> {
  if (res.ok) return
  const body = await res.text().catch(() => "")
  throw new OpenCodeError(`OpenCode ${method} ${path} responded ${res.status}`, res.status, body)
}

async function getJson<T>(path: string, query?: Query): Promise<T> {
  const res = await fetch(buildUrl(path, query), { method: "GET" })
  await ensureOk(res, "GET", path)
  const data: T = await res.json()
  return data
}

async function postJson<T>(path: string, query?: Query, body?: unknown): Promise<T> {
  const res = await fetch(buildUrl(path, query), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  await ensureOk(res, "POST", path)
  const data: T = await res.json()
  return data
}

async function send(method: string, path: string, query?: Query, body?: unknown): Promise<void> {
  const res = await fetch(buildUrl(path, query), {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  await ensureOk(res, method, path)
}

// ---------------------------------------------------------------------------
// OpenCode client — endpoint paths verified against OpenCode v1.18.0.
// NOTE: the live API uses `/session/{id}/prompt_async` (underscore) and the
// SSE endpoint is `/event` (not `/event/subscribe`); prompt parts use `text`.
// ---------------------------------------------------------------------------

export const opencode = {
  listSessions(directory: string): Promise<Session[]> {
    return getJson<Session[]>("/session", { directory })
  },

  createSession(directory: string, opts: { agent?: string; title?: string }): Promise<Session> {
    return postJson<Session>("/session", { directory }, { title: opts.title, agent: opts.agent })
  },

  getSession(sessionId: string): Promise<Session> {
    return getJson<Session>(`/session/${sessionId}`, { directory: WORKSPACE_DIR })
  },

  deleteSession(sessionId: string): Promise<void> {
    return send("DELETE", `/session/${sessionId}`, { directory: WORKSPACE_DIR })
  },

  // Forwarded verbatim from OpenCode (each item is `{ info, parts }`).
  getMessages(sessionId: string, directory: string): Promise<Message[]> {
    return getJson<Message[]>(`/session/${sessionId}/message`, { directory })
  },

  // Fire-and-forget: OpenCode starts generation and returns immediately.
  prompt(
    sessionId: string,
    directory: string,
    content: string,
    opts?: { agent?: string },
  ): Promise<void> {
    return send("POST", `/session/${sessionId}/prompt_async`, { directory }, {
      parts: [{ type: "text", text: content }],
      agent: opts?.agent,
    })
  },

  abort(sessionId: string): Promise<void> {
    return send("POST", `/session/${sessionId}/abort`, { directory: WORKSPACE_DIR })
  },

  getTodos(sessionId: string, directory: string): Promise<Todo[]> {
    return getJson<Todo[]>(`/session/${sessionId}/todo`, { directory })
  },

  getSessionStatus(directory: string): Promise<Record<string, SessionStatus>> {
    return getJson<Record<string, SessionStatus>>("/session/status", { directory })
  },

  listAgents(): Promise<Agent[]> {
    return getJson<Agent[]>("/agent", { directory: WORKSPACE_DIR })
  },

  // EventSource primitive over OpenCode's global `/event` SSE stream. The
  // session-scoped proxy in routes/events.ts uses `eventStream` instead for
  // lifecycle control (abort + filtering); this is the client-level surface.
  subscribeEvents(directory: string): EventSource {
    return new EventSource(buildUrl("/event", { directory }))
  },

  // Raw streaming fetch against `/event`, used by the SSE proxy so it can
  // abort the upstream connection and parse/filter frames itself.
  async eventStream(directory: string, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(buildUrl("/event", { directory }), {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal,
    })
    await ensureOk(res, "GET", "/event")
    return res
  },
}

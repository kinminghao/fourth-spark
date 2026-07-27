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

export type ProviderModel = {
  id: string
  name?: string
  status?: string
  capabilities?: {
    toolcall?: boolean
    output?: { text?: boolean; image?: boolean }
  }
  cost?: { input?: number; output?: number }
  limit?: { context?: number }
}

export type Provider = {
  id: string
  name?: string
  models?: Record<string, ProviderModel>
}

export type ProviderListResponse = {
  all: Provider[]
  default?: unknown
  connected?: unknown
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
// OpenCode client interface — one instance per repo.
// ---------------------------------------------------------------------------

export interface OpenCodeClient {
  readonly baseUrl: string
  readonly directory: string

  listSessions(): Promise<Session[]>
  createSession(opts: { agent?: string; title?: string }): Promise<Session>
  getSession(sessionId: string): Promise<Session>
  deleteSession(sessionId: string): Promise<void>
  getMessages(sessionId: string): Promise<Message[]>
  prompt(sessionId: string, content: string, opts?: { agent?: string; model?: string; variant?: string }): Promise<void>
  abort(sessionId: string): Promise<void>
  getTodos(sessionId: string): Promise<Todo[]>
  getSessionStatus(): Promise<Record<string, SessionStatus>>
  listAgents(): Promise<Agent[]>
  getProviders(): Promise<ProviderListResponse>
  eventStream(signal?: AbortSignal): Promise<Response>
}

// ---------------------------------------------------------------------------
// Low-level fetch helpers (closed over baseUrl)
// ---------------------------------------------------------------------------

type Query = Record<string, string | undefined>

function makeFetchers(baseUrl: string) {
  function buildUrl(path: string, query?: Query): string {
    const url = new URL(path, baseUrl)
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
    return await res.json() as T
  }

  async function postJson<T>(path: string, query?: Query, body?: unknown): Promise<T> {
    const res = await fetch(buildUrl(path, query), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    })
    await ensureOk(res, "POST", path)
    return await res.json() as T
  }

  async function send(method: string, path: string, query?: Query, body?: unknown): Promise<void> {
    const res = await fetch(buildUrl(path, query), {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    await ensureOk(res, method, path)
  }

  return { buildUrl, ensureOk, getJson, postJson, send }
}

// ---------------------------------------------------------------------------
// Factory — creates one OpenCode client bound to a specific baseUrl + directory.
// Endpoint paths verified against OpenCode v1.18.0.
// ---------------------------------------------------------------------------

export function createOpenCodeClient(baseUrl: string, directory: string): OpenCodeClient {
  const { buildUrl, ensureOk, getJson, postJson, send } = makeFetchers(baseUrl)

  return {
    baseUrl,
    directory,

    listSessions() {
      return getJson<Session[]>("/session", { directory })
    },

    createSession(opts) {
      return postJson<Session>("/session", { directory }, { title: opts.title, agent: opts.agent })
    },

    getSession(sessionId) {
      return getJson<Session>(`/session/${sessionId}`, { directory })
    },

    deleteSession(sessionId) {
      return send("DELETE", `/session/${sessionId}`, { directory })
    },

    getMessages(sessionId) {
      return getJson<Message[]>(`/session/${sessionId}/message`, { directory })
    },

    prompt(sessionId, content, opts) {
      let model: { modelID: string; providerID: string } | undefined
      if (opts?.model) {
        const slash = opts.model.indexOf("/")
        model = slash > 0
          ? { providerID: opts.model.slice(0, slash), modelID: opts.model.slice(slash + 1) }
          : { providerID: "anthropic", modelID: opts.model }
      }
      return send("POST", `/session/${sessionId}/prompt_async`, { directory }, {
        parts: [{ type: "text", text: content }],
        agent: opts?.agent,
        model,
        variant: opts?.variant,
      })
    },

    abort(sessionId) {
      return send("POST", `/session/${sessionId}/abort`, { directory })
    },

    getTodos(sessionId) {
      return getJson<Todo[]>(`/session/${sessionId}/todo`, { directory })
    },

    getSessionStatus() {
      return getJson<Record<string, SessionStatus>>("/session/status", { directory })
    },

    listAgents() {
      return getJson<Agent[]>("/agent", { directory })
    },

    getProviders() {
      return getJson<ProviderListResponse>("/provider", { directory })
    },

    async eventStream(signal?) {
      const res = await fetch(buildUrl("/event", { directory }), {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal,
      })
      await ensureOk(res, "GET", "/event")
      return res
    },
  }
}

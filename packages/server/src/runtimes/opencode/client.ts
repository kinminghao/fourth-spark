// ---------------------------------------------------------------------------
// HttpRuntimeClient — HTTP-backed RuntimeClient for a locally running
// `opencode serve` process. Extracted from lib/opencode.ts; endpoints and
// request shapes are preserved exactly (OpenCode v1.18.0).
// ---------------------------------------------------------------------------

import type { RuntimeClient } from "../../core/runtime-client"
import {
  RuntimeError,
  type Session,
  type Message,
  type Todo,
  type Agent,
  type SessionStatus,
  type PendingQuestion,
  type ProviderListResponse,
  type PromptOpts,
} from "../../core/runtime-types"

const RUNTIME_ID = "opencode"

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
    throw new RuntimeError(RUNTIME_ID, `OpenCode ${method} ${path} responded ${res.status}`, res.status, body)
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

export class HttpRuntimeClient implements RuntimeClient {
  readonly baseUrl: string
  readonly directory: string
  private readonly fetchers: ReturnType<typeof makeFetchers>

  constructor(baseUrl: string, directory: string) {
    this.baseUrl = baseUrl
    this.directory = directory
    this.fetchers = makeFetchers(baseUrl)
  }

  withDirectory(directory: string): RuntimeClient {
    return new HttpRuntimeClient(this.baseUrl, directory)
  }

  listSessions(): Promise<Session[]> {
    return this.fetchers.getJson<Session[]>("/session", { directory: this.directory })
  }

  createSession(opts: { agent?: string; title?: string }): Promise<Session> {
    return this.fetchers.postJson<Session>(
      "/session",
      { directory: this.directory },
      { title: opts.title, agent: opts.agent },
    )
  }

  getSession(sessionId: string): Promise<Session> {
    return this.fetchers.getJson<Session>(`/session/${sessionId}`, { directory: this.directory })
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.fetchers.send("DELETE", `/session/${sessionId}`, { directory: this.directory })
  }

  getMessages(sessionId: string): Promise<Message[]> {
    return this.fetchers.getJson<Message[]>(`/session/${sessionId}/message`, { directory: this.directory })
  }

  prompt(sessionId: string, content: string, opts?: PromptOpts): Promise<void> {
    let model: { modelID: string; providerID: string } | undefined
    if (opts?.model) {
      const slash = opts.model.indexOf("/")
      model = slash > 0
        ? { providerID: opts.model.slice(0, slash), modelID: opts.model.slice(slash + 1) }
        : { providerID: "anthropic", modelID: opts.model }
    }
    return this.fetchers.send("POST", `/session/${sessionId}/prompt_async`, { directory: this.directory }, {
      parts: [
        { type: "text", text: content },
        ...(opts?.files ?? []).map((f) => ({ type: "file", mime: f.mime, url: f.url, filename: f.filename })),
      ],
      agent: opts?.agent,
      model,
      variant: opts?.variant,
    })
  }

  abort(sessionId: string): Promise<void> {
    return this.fetchers.send("POST", `/session/${sessionId}/abort`, { directory: this.directory })
  }

  getTodos(sessionId: string): Promise<Todo[]> {
    return this.fetchers.getJson<Todo[]>(`/session/${sessionId}/todo`, { directory: this.directory })
  }

  getSessionStatus(): Promise<Record<string, SessionStatus>> {
    return this.fetchers.getJson<Record<string, SessionStatus>>("/session/status", { directory: this.directory })
  }

  listQuestions(): Promise<PendingQuestion[]> {
    return this.fetchers.getJson<PendingQuestion[]>("/question", { directory: this.directory })
  }

  replyQuestion(requestID: string, answers: string[][]): Promise<void> {
    return this.fetchers.send("POST", `/question/${requestID}/reply`, { directory: this.directory }, { answers })
  }

  rejectQuestion(requestID: string): Promise<void> {
    return this.fetchers.send("POST", `/question/${requestID}/reject`, { directory: this.directory })
  }

  listAgents(): Promise<Agent[]> {
    return this.fetchers.getJson<Agent[]>("/agent", { directory: this.directory })
  }

  getProviders(): Promise<ProviderListResponse> {
    return this.fetchers.getJson<ProviderListResponse>("/provider", { directory: this.directory })
  }

  async eventStream(signal?: AbortSignal): Promise<Response> {
    const res = await fetch(this.fetchers.buildUrl("/event", { directory: this.directory }), {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal,
    })
    await this.fetchers.ensureOk(res, "GET", "/event")
    return res
  }
}

export function createHttpRuntimeClient(baseUrl: string, directory: string): RuntimeClient {
  return new HttpRuntimeClient(baseUrl, directory)
}

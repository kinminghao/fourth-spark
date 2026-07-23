/*
 * API client for the Fourth Spark backend (mounted under /api/*, proxied by Vite).
 *
 * All session/agent calls are scoped to a repo via /api/repos/:repoId/*.
 */

export type SessionStatusValue = "idle" | "busy" | "retry"

export interface Repo {
  id: string
  name: string
  gitUrl: string
  localPath: string
  port: number | null
  status: string
  running: boolean
  createdAt: number
  updatedAt: number
}

export interface Session {
  id: string
  title?: string
  agent?: string
  issueId?: string
  createdAt?: string
  time?: { created?: number; updated?: number }
  parentID?: string
}

export interface Issue {
  id: string
  repoId: string
  parentId?: string
  number: number
  title: string
  body?: string
  state: "open" | "closed"
  labels?: Array<{ id: number; name: string; color: string }>
  htmlUrl?: string
  createdAt: number
  updatedAt: number
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

// ---------------------------------------------------------------------------
// Repo API — /api/repos
// ---------------------------------------------------------------------------

export async function listRepos(): Promise<Repo[]> {
  return unwrapList<Repo>(await apiFetch<unknown>("/api/repos"), "repos")
}

export async function createRepo(name: string, gitUrl: string, localPath: string): Promise<Repo> {
  return apiFetch<Repo>("/api/repos", {
    method: "POST",
    body: JSON.stringify({ name, gitUrl, localPath }),
  })
}

export interface RepoResolveResult {
  name: string
  gitUrl: string
  localPath: string
}

export async function resolveRepo(localPath: string): Promise<RepoResolveResult> {
  return apiFetch<RepoResolveResult>("/api/repos/resolve", {
    method: "POST",
    body: JSON.stringify({ localPath }),
  })
}

export async function deleteRepo(id: string): Promise<void> {
  await apiFetch<void>(`/api/repos/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export async function startRepo(id: string): Promise<void> {
  await apiFetch<void>(`/api/repos/${encodeURIComponent(id)}/start`, { method: "POST" })
}

export async function stopRepo(id: string): Promise<void> {
  await apiFetch<void>(`/api/repos/${encodeURIComponent(id)}/stop`, { method: "POST" })
}

// ---------------------------------------------------------------------------
// Repo-scoped helpers
// ---------------------------------------------------------------------------

function repoBase(repoId: string): string {
  return `/api/repos/${encodeURIComponent(repoId)}`
}

// ---------------------------------------------------------------------------
// Session API — /api/repos/:repoId/sessions
// ---------------------------------------------------------------------------

export async function listSessions(repoId: string): Promise<Session[]> {
  return unwrapList<Session>(await apiFetch<unknown>(`${repoBase(repoId)}/sessions`), "sessions")
}

export async function createSession(
  repoId: string,
  message: string,
  agent?: string,
  model?: string,
  variant?: string,
  issueId?: string,
): Promise<Session> {
  return apiFetch<Session>(`${repoBase(repoId)}/sessions`, {
    method: "POST",
    body: JSON.stringify({ message, agent, model, variant, issueId }),
  })
}

export async function getSession(repoId: string, id: string): Promise<Session> {
  return apiFetch<Session>(`${repoBase(repoId)}/sessions/${encodeURIComponent(id)}`)
}

export async function deleteSession(repoId: string, id: string): Promise<void> {
  await apiFetch<void>(`${repoBase(repoId)}/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function sendMessage(repoId: string, sessionId: string, content: string, agent?: string): Promise<void> {
  await apiFetch<void>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/prompt`,
    { method: "POST", body: JSON.stringify({ content, agent }) },
  )
}

export async function abortSession(repoId: string, sessionId: string): Promise<void> {
  await apiFetch<void>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/abort`,
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

export async function getMessages(repoId: string, sessionId: string): Promise<Message[]> {
  const raw = unwrapList<unknown>(
    await apiFetch<unknown>(`${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/messages`),
    "messages",
  )
  return raw.map(normalizeMessage)
}

export async function getTodos(repoId: string, sessionId: string): Promise<Todo[]> {
  return unwrapList<Todo>(
    await apiFetch<unknown>(`${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/todos`),
    "todos",
  )
}

export async function getSessionStatus(repoId: string, sessionId: string): Promise<SessionStatus> {
  return apiFetch<SessionStatus>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/status`,
  )
}

// ---------------------------------------------------------------------------
// Agent API — /api/repos/:repoId/agents
// ---------------------------------------------------------------------------

export async function listAgents(repoId: string): Promise<Agent[]> {
  return unwrapList<Agent>(await apiFetch<unknown>(`${repoBase(repoId)}/agents`), "agents")
}

// ---------------------------------------------------------------------------
// Issue API — /api/repos/:repoId/issues
// ---------------------------------------------------------------------------

export async function listIssues(repoId: string, state = "open"): Promise<Issue[]> {
  return unwrapList<Issue>(
    await apiFetch<unknown>(`${repoBase(repoId)}/issues?state=${encodeURIComponent(state)}`),
    "issues",
  )
}

export async function syncIssues(repoId: string, state = "all"): Promise<{ synced: number }> {
  return apiFetch<{ synced: number }>(`${repoBase(repoId)}/issues/sync`, {
    method: "POST",
    body: JSON.stringify({ state }),
  })
}

export async function createIssue(repoId: string, title: string, body?: string): Promise<Issue> {
  return apiFetch<Issue>(`${repoBase(repoId)}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body }),
  })
}

export async function linkChildIssue(repoId: string, parentNumber: number, childNumber: number): Promise<void> {
  await apiFetch<void>(`${repoBase(repoId)}/issues/${parentNumber}/children`, {
    method: "POST",
    body: JSON.stringify({ childNumber }),
  })
}

export async function updateSessionIssue(repoId: string, sessionId: string, issueId: string | null): Promise<void> {
  await apiFetch<void>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "PATCH", body: JSON.stringify({ issueId }) },
  )
}

// ---------------------------------------------------------------------------
// SSE URL builder — used by useSessionEvents hook
// ---------------------------------------------------------------------------

export function sessionEventsUrl(repoId: string, sessionId: string): string {
  return `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/events`
}

// ---------------------------------------------------------------------------
// Settings API — /api/settings
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<Record<string, string>> {
  return apiFetch<Record<string, string>>("/api/settings")
}

export async function updateSetting(key: string, value: string): Promise<void> {
  await apiFetch<void>(`/api/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  })
}

export async function deleteSetting(key: string): Promise<void> {
  await apiFetch<void>(`/api/settings/${encodeURIComponent(key)}`, { method: "DELETE" })
}

// ---------------------------------------------------------------------------
// Git Host API — /api/git-hosts
// ---------------------------------------------------------------------------

export interface GitHost {
  id: string
  host: string
  platform: string
  name: string
  token: string
  createdAt: number
  updatedAt: number
}

export async function listGitHosts(): Promise<GitHost[]> {
  return unwrapList<GitHost>(await apiFetch<unknown>("/api/git-hosts"), "gitHosts")
}

export async function createGitHost(host: string, name: string, token: string, platform = "gitea"): Promise<GitHost> {
  return apiFetch<GitHost>("/api/git-hosts", {
    method: "POST",
    body: JSON.stringify({ host, name, token, platform }),
  })
}

export async function updateGitHost(id: string, updates: { host?: string; name?: string; token?: string; platform?: string }): Promise<GitHost> {
  return apiFetch<GitHost>(`/api/git-hosts/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  })
}

export async function deleteGitHost(id: string): Promise<void> {
  await apiFetch<void>(`/api/git-hosts/${encodeURIComponent(id)}`, { method: "DELETE" })
}

// ---------------------------------------------------------------------------
// Usage API — /api/usage (Claude subscription quota)
// ---------------------------------------------------------------------------

export interface UsageWindow {
  utilization: number
  resets_at?: string
}

export interface ScopedUsageWindow extends UsageWindow {
  label: string
}

export interface UsageResponse {
  five_hour?: UsageWindow | null
  seven_day?: UsageWindow | null
  seven_day_sonnet?: UsageWindow | null
  seven_day_opus?: UsageWindow | null
  scoped?: ScopedUsageWindow[]
}

export interface AccountUsage {
  id: string
  label: string
  active: boolean
  excluded: boolean
  usage?: UsageResponse
  error?: string
  needsReauth?: boolean
}

export interface UsageResult {
  activeId?: string
  accounts: AccountUsage[]
}

export async function fetchUsage(): Promise<UsageResult> {
  return apiFetch<UsageResult>("/api/usage")
}

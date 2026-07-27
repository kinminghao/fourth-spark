/*
 * API client for the Fourth Spark backend.
 *
 * In browser: paths like "/api/…" are proxied by Vite to the backend.
 * In Capacitor: getApiBaseUrl() prepends the remote server address.
 *
 * All session/agent calls are scoped to a repo via /api/repos/:repoId/*.
 */

import { getApiBaseUrl } from "./config"

export type SessionStatusValue = "idle" | "busy" | "retry"

export interface Repo {
  id: string
  name: string
  gitUrl: string
  localPath: string
  port: number | null
  status: string
  running: boolean
  branch: string | null
  createdAt: number
  updatedAt: number
}

export interface SessionTokens {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface Session {
  id: string
  title?: string
  agent?: string
  issueId?: string
  createdAt?: string
  time?: { created?: number; updated?: number }
  parentID?: string
  cost?: number
  tokens?: SessionTokens
  model?: { providerID?: string; modelID?: string; variant?: string }
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
  tokens?: SessionTokens
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

export interface PromptFragment {
  id: string
  name: string
  content: string
  repoId: string | null
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface PromptFragment {
  id: string
  name: string
  content: string
  repoId: string | null
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface CustomAgent {
  id: string
  name: string
  baseAgent: string
  model: string | null
  systemPrompt: string
  fragments: Array<{ id: string; name: string; content: string }>
  repoId: string | null
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface ModelInfo {
  id: string
  name: string
  providerID: string
  providerName: string
  cost?: { input?: number; output?: number }
  contextLimit?: number
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
    response = await fetch(getApiBaseUrl() + path, {
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
  customAgentId?: string,
): Promise<Session> {
  return apiFetch<Session>(`${repoBase(repoId)}/sessions`, {
    method: "POST",
    body: JSON.stringify({ message, agent, model, variant, issueId, customAgentId }),
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
// Custom Agent API
// ---------------------------------------------------------------------------

export async function listGlobalCustomAgents(): Promise<CustomAgent[]> {
  return unwrapList<CustomAgent>(await apiFetch<unknown>("/api/custom-agents"))
}

export async function createGlobalCustomAgent(data: { name: string; baseAgent: string; model?: string; systemPrompt?: string; fragmentIds?: string[] }): Promise<CustomAgent> {
  return apiFetch<CustomAgent>("/api/custom-agents", { method: "POST", body: JSON.stringify(data) })
}

export async function updateCustomAgent(id: string, data: { name?: string; baseAgent?: string; model?: string | null; systemPrompt?: string; fragmentIds?: string[] }): Promise<CustomAgent> {
  return apiFetch<CustomAgent>(`/api/custom-agents/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) })
}

export async function deleteCustomAgent(id: string): Promise<void> {
  await apiFetch<void>(`/api/custom-agents/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export async function listRepoCustomAgents(repoId: string): Promise<CustomAgent[]> {
  return unwrapList<CustomAgent>(await apiFetch<unknown>(`${repoBase(repoId)}/custom-agents`))
}

export async function createRepoCustomAgent(repoId: string, data: { name: string; baseAgent: string; model?: string; systemPrompt?: string }): Promise<CustomAgent> {
  return apiFetch<CustomAgent>(`${repoBase(repoId)}/custom-agents`, { method: "POST", body: JSON.stringify(data) })
}

// ---------------------------------------------------------------------------
// Model API — /api/repos/:repoId/models
// ---------------------------------------------------------------------------

export async function listModels(repoId: string): Promise<ModelInfo[]> {
  return unwrapList<ModelInfo>(await apiFetch<unknown>(`${repoBase(repoId)}/models`))
}

// ---------------------------------------------------------------------------
// Prompt Fragment API
// ---------------------------------------------------------------------------

export async function listGlobalFragments(): Promise<PromptFragment[]> {
  return unwrapList<PromptFragment>(await apiFetch<unknown>("/api/prompt-fragments"))
}

export async function createGlobalFragment(data: { name: string; content?: string }): Promise<PromptFragment> {
  return apiFetch<PromptFragment>("/api/prompt-fragments", { method: "POST", body: JSON.stringify(data) })
}

export async function updateFragment(id: string, data: { name?: string; content?: string }): Promise<PromptFragment> {
  return apiFetch<PromptFragment>(`/api/prompt-fragments/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) })
}

export async function deleteFragment(id: string): Promise<void> {
  await apiFetch<void>(`/api/prompt-fragments/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export async function listRepoFragments(repoId: string): Promise<PromptFragment[]> {
  return unwrapList<PromptFragment>(await apiFetch<unknown>(`${repoBase(repoId)}/prompt-fragments`))
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

export interface IssueComment {
  id: number
  body: string
  user: { login: string; avatar_url: string }
  created_at: string
  updated_at: string
}

export async function updateIssue(
  repoId: string,
  issueNumber: number,
  updates: { title?: string; body?: string; state?: "open" | "closed" },
): Promise<Issue> {
  return apiFetch<Issue>(`${repoBase(repoId)}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  })
}

export interface PullRequest {
  number: number
  title: string
  body: string
  state: string
  html_url: string
  user: { login: string; avatar_url: string }
  created_at: string
  updated_at: string
}

export async function listIssuePullRequests(repoId: string, issueNumber: number): Promise<PullRequest[]> {
  return unwrapList<PullRequest>(
    await apiFetch<unknown>(`${repoBase(repoId)}/issues/${issueNumber}/pulls`),
  )
}

export async function mergePullRequest(
  repoId: string,
  issueNumber: number,
  prNumber: number,
  closeIssue = false,
): Promise<void> {
  await apiFetch<void>(
    `${repoBase(repoId)}/issues/${issueNumber}/pulls/${prNumber}/merge`,
    { method: "POST", body: JSON.stringify({ closeIssue }) },
  )
}

export async function listIssueComments(repoId: string, issueNumber: number): Promise<IssueComment[]> {
  return apiFetch<IssueComment[]>(`${repoBase(repoId)}/issues/${issueNumber}/comments`)
}

export async function updateSessionIssue(repoId: string, sessionId: string, issueId: string | null): Promise<void> {
  await apiFetch<void>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "PATCH", body: JSON.stringify({ issueId }) },
  )
}

// ---------------------------------------------------------------------------
// AGENTS.md API — global + repo-scoped
// ---------------------------------------------------------------------------

export async function getGlobalAgentsMd(): Promise<{ content: string }> {
  return apiFetch<{ content: string }>("/api/agents-md")
}

export async function updateGlobalAgentsMd(content: string): Promise<void> {
  await apiFetch<void>("/api/agents-md", {
    method: "PUT",
    body: JSON.stringify({ content }),
  })
}

export async function getRepoAgentsMd(repoId: string): Promise<{ content: string }> {
  return apiFetch<{ content: string }>(`/api/repos/${encodeURIComponent(repoId)}/agents-md`)
}

export async function updateRepoAgentsMd(repoId: string, content: string): Promise<void> {
  await apiFetch<void>(`/api/repos/${encodeURIComponent(repoId)}/agents-md`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  })
}

// ---------------------------------------------------------------------------
// SSE URL builder — global repo event stream
// ---------------------------------------------------------------------------

export function repoEventsUrl(repoId: string): string {
  return `${getApiBaseUrl()}${repoBase(repoId)}/events`
}

export async function getAllSessionStatuses(repoId: string): Promise<Record<string, SessionStatus>> {
  return apiFetch<Record<string, SessionStatus>>(`${repoBase(repoId)}/sessions/status`)
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

export async function switchUsageAccount(accountId: string): Promise<UsageResult> {
  return apiFetch<UsageResult>("/api/usage/switch", {
    method: "POST",
    body: JSON.stringify({ accountId }),
  })
}

// ---------------------------------------------------------------------------
// Push Notification API — /api/push
// ---------------------------------------------------------------------------

export async function registerPushToken(token: string, platform = "ios"): Promise<void> {
  await apiFetch<void>("/api/push/register", {
    method: "POST",
    body: JSON.stringify({ token, platform }),
  })
}

export async function unregisterPushToken(token: string): Promise<void> {
  await apiFetch<void>("/api/push/unregister", {
    method: "DELETE",
    body: JSON.stringify({ token }),
  })
}

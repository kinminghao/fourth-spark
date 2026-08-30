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
  worktreeEnabled: boolean
  runtimeType?: string
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
  completedAt?: number
  revert?: { messageID: string }
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
  milestoneId?: string | null
  htmlUrl?: string
  authorLogin?: string
  authorAvatar?: string
  assignees?: Array<{ login: string; avatar_url: string }>
  commentCount?: number
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
  // File parts — url is a data: URL
  mime?: string
  url?: string
  filename?: string
}

export interface PromptFile {
  mime: string
  url: string
  filename?: string
}

export interface Message {
  id: string
  role: string
  parts?: MessagePart[]
  info?: {
    agent?: string
    modelID?: string
    providerID?: string
    error?: { name?: string; data?: { message?: string } }
    finish?: string
  }
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

export interface CustomAgent {
  id: string
  name: string
  description: string
  baseAgent: string
  model: string | null
  variant: string | null
  systemPrompt: string
  systemPromptPosition: number
  isSystem: number
  memoryModel: string | null
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
  configured: boolean
  cost?: { input?: number; output?: number }
  contextLimit?: number
  supportsImage?: boolean
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

export async function createRepo(name: string, gitUrl: string, localPath: string, runtimeType?: string): Promise<Repo> {
  return apiFetch<Repo>("/api/repos", {
    method: "POST",
    body: JSON.stringify({ name, gitUrl, localPath, runtimeType }),
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

export interface BranchList {
  current: string | null
  local: string[]
  remote: string[]
}

export async function listBranches(repoId: string): Promise<BranchList> {
  return apiFetch<BranchList>(`/api/repos/${encodeURIComponent(repoId)}/branches`)
}

export async function checkoutBranch(repoId: string, branch: string): Promise<{ ok: boolean; branch: string }> {
  return apiFetch<{ ok: boolean; branch: string }>(`/api/repos/${encodeURIComponent(repoId)}/checkout`, {
    method: "POST",
    body: JSON.stringify({ branch }),
  })
}

export interface PullResult {
  ok: boolean
  output: string
  branch: string | null
  summary: string
  alreadyUpToDate: boolean
  autostashed: boolean
  filesChanged: number
}

export async function pullRepo(id: string): Promise<PullResult> {
  return apiFetch<PullResult>(`/api/repos/${encodeURIComponent(id)}/pull`, { method: "POST" })
}

// ---------------------------------------------------------------------------
// Repo-scoped helpers
// ---------------------------------------------------------------------------

function repoBase(repoId: string): string {
  return `/api/repos/${encodeURIComponent(repoId)}`
}

// ---------------------------------------------------------------------------
// Workspace API — /api/repos/:repoId/workspaces
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string
  repoId: string
  branch: string
  localPath: string
  baseBranch: string
  status: string
  port: number | null
  createdAt: number
  updatedAt: number
  diskUsage: number
  merged: boolean
  running: boolean
}

export async function listWorkspaces(repoId: string): Promise<Workspace[]> {
  return unwrapList<Workspace>(
    await apiFetch<unknown>(`${repoBase(repoId)}/workspaces`),
    "workspaces",
  )
}

export async function removeWorkspace(repoId: string, workspaceId: string): Promise<void> {
  await apiFetch<void>(`${repoBase(repoId)}/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE",
  })
}

export async function cleanupWorkspaces(repoId: string): Promise<{ removed: number }> {
  return apiFetch<{ removed: number }>(`${repoBase(repoId)}/workspaces/cleanup`, {
    method: "POST",
  })
}

export async function toggleWorktree(repoId: string, enabled: boolean): Promise<void> {
  await apiFetch(`/api/repos/${repoId}/worktree`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  })
}

export async function switchRuntime(repoId: string, runtimeType: string): Promise<void> {
  await apiFetch(`/api/repos/${repoId}/runtime`, {
    method: "PATCH",
    body: JSON.stringify({ runtimeType }),
  })
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
  files?: PromptFile[],
): Promise<Session> {
  return apiFetch<Session>(`${repoBase(repoId)}/sessions`, {
    method: "POST",
    body: JSON.stringify({ message, agent, model, variant, issueId, customAgentId, files }),
  })
}

export async function deleteSession(repoId: string, id: string): Promise<void> {
  await apiFetch<void>(`${repoBase(repoId)}/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function sendMessage(repoId: string, sessionId: string, content: string, agent?: string, model?: string, variant?: string, files?: PromptFile[]): Promise<void> {
  await apiFetch<void>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/prompt`,
    { method: "POST", body: JSON.stringify({ content, agent, model, variant, files }) },
  )
}

export async function abortSession(repoId: string, sessionId: string): Promise<void> {
  await apiFetch<void>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/abort`,
    { method: "POST" },
  )
}

export async function replyQuestion(repoId: string, sessionId: string, answers: string[][]): Promise<void> {
  await apiFetch<void>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/questions/reply`,
    { method: "POST", body: JSON.stringify({ answers }) },
  )
}

export async function rejectQuestion(repoId: string, sessionId: string): Promise<void> {
  await apiFetch<void>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/questions/reject`,
    { method: "POST" },
  )
}

export async function revertSession(repoId: string, sessionId: string, messageID: string): Promise<Session> {
  return apiFetch<Session>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/revert`,
    { method: "POST", body: JSON.stringify({ messageID }) },
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

export interface PaginatedMessages {
  messages: Message[]
  total: number
  hasMore: boolean
}

export async function getMessages(
  repoId: string,
  sessionId: string,
  opts?: { limit?: number; before?: string },
): Promise<PaginatedMessages> {
  const params = new URLSearchParams()
  if (opts?.limit) params.set("limit", String(opts.limit))
  if (opts?.before) params.set("before", opts.before)
  const qs = params.toString()
  const url = `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ""}`
  const raw = await apiFetch<unknown>(url)
  if (Array.isArray(raw)) {
    const msgs = raw.map(normalizeMessage)
    return { messages: msgs, total: msgs.length, hasMore: false }
  }
  const data = raw as { messages: unknown[]; total: number; hasMore: boolean }
  const msgList = Array.isArray(data.messages) ? data.messages : []
  return {
    messages: msgList.map(normalizeMessage),
    total: data.total ?? msgList.length,
    hasMore: data.hasMore ?? false,
  }
}

export async function getSessionStatus(repoId: string, sessionId: string): Promise<SessionStatus> {
  return apiFetch<SessionStatus>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/status`,
  )
}

export interface SessionLinks {
  issues: Issue[]
  pullRequests: PersistentPullRequest[]
}

export async function getSessionLinks(repoId: string, sessionId: string): Promise<SessionLinks> {
  return apiFetch<SessionLinks>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/links`,
  )
}

export interface SessionSnapshot {
  session: Session | null
  todos: Todo[]
  status: SessionStatus
  links: SessionLinks
}

export async function getSessionSnapshot(repoId: string, sessionId: string): Promise<SessionSnapshot> {
  return apiFetch<SessionSnapshot>(
    `${repoBase(repoId)}/sessions/snapshot/${encodeURIComponent(sessionId)}`,
  )
}

export interface SessionLinkSummary {
  issues: Array<{ id: string; number: number; title: string; state: string }>
  pullRequests: Array<{ id: string; number: number; title: string; state: string; mergedAt?: number | null }>
}

export async function getAllSessionLinks(repoId: string): Promise<Record<string, SessionLinkSummary>> {
  return apiFetch<Record<string, SessionLinkSummary>>(
    `${repoBase(repoId)}/sessions/all-links`,
  )
}

export async function addSessionLink(repoId: string, sessionId: string, type: "issue" | "pr", targetId: string): Promise<void> {
  await apiFetch<void>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/links`,
    { method: "POST", body: JSON.stringify({ type, targetId }) },
  )
}

export async function removeSessionLink(repoId: string, sessionId: string, type: "issue" | "pr", targetId: string): Promise<void> {
  await apiFetch<void>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}/links`,
    { method: "DELETE", body: JSON.stringify({ type, targetId }) },
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

export async function createGlobalCustomAgent(data: { name: string; baseAgent: string; model?: string; variant?: string; systemPrompt?: string; systemPromptPosition?: number; fragmentIds?: string[] }): Promise<CustomAgent> {
  return apiFetch<CustomAgent>("/api/custom-agents", { method: "POST", body: JSON.stringify(data) })
}

export async function updateCustomAgent(id: string, data: { name?: string; baseAgent?: string; model?: string | null; variant?: string | null; memoryModel?: string | null; systemPrompt?: string; systemPromptPosition?: number; fragmentIds?: string[] }): Promise<CustomAgent> {
  return apiFetch<CustomAgent>(`/api/custom-agents/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) })
}

export async function deleteCustomAgent(id: string): Promise<void> {
  await apiFetch<void>(`/api/custom-agents/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export interface CustomAgentExport {
  version: number
  type: "fourth-spark-custom-agent"
  exportedAt: number
  agent: { name: string; baseAgent: string; model: string | null; variant: string | null; systemPrompt: string }
  fragments: Array<{ name: string; content: string }>
}

export async function exportCustomAgent(id: string): Promise<CustomAgentExport> {
  return apiFetch<CustomAgentExport>(`/api/custom-agents/${encodeURIComponent(id)}/export`)
}

export async function importCustomAgent(data: CustomAgentExport): Promise<CustomAgent> {
  return apiFetch<CustomAgent>("/api/custom-agents/import", { method: "POST", body: JSON.stringify(data) })
}

export interface MemoryVersion {
  content: string
  importance: number
  category: string
  action: "create" | "update" | "merge" | "decay" | "reinforce" | "manual"
  ts: number
  source?: string
}

export interface AgentMemory {
  id: string
  customAgentId: string
  sessionId: string | null
  mergedFrom: string[] | null
  content: string
  category: string
  importance: number
  supersededBy: string | null
  history: MemoryVersion[] | null
  createdAt: number
  updatedAt: number
}

export async function listAgentMemories(agentId: string, opts?: { category?: string; includeSuperseded?: boolean }): Promise<AgentMemory[]> {
  const params = new URLSearchParams()
  if (opts?.category) params.set("category", opts.category)
  if (opts?.includeSuperseded) params.set("includeSuperseded", "true")
  const qs = params.toString()
  return apiFetch<AgentMemory[]>(`/api/custom-agents/${encodeURIComponent(agentId)}/memories${qs ? `?${qs}` : ""}`)
}

export async function updateAgentMemory(agentId: string, memId: string, data: { content?: string; category?: string; importance?: number }): Promise<AgentMemory> {
  return apiFetch<AgentMemory>(`/api/custom-agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(memId)}`, { method: "PUT", body: JSON.stringify(data) })
}

export async function deleteAgentMemory(agentId: string, memId: string): Promise<void> {
  await apiFetch<void>(`/api/custom-agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(memId)}`, { method: "DELETE" })
}

export async function extractAgentMemories(agentId: string, sessionIds: string[]): Promise<{ queued: number }> {
  return apiFetch<{ queued: number }>(`/api/custom-agents/${encodeURIComponent(agentId)}/memories/extract`, { method: "POST", body: JSON.stringify({ sessionIds }) })
}

export interface MemoryChange {
  action: "update" | "merge" | "delete" | "reinforce" | "decay" | "add"
  ts: number
  oldContent?: string
  oldImportance?: number
  newImportance?: number
  sourceContents?: string[]
  sourceIds?: string[]
  reason?: string
}

export interface ConsolidationStats {
  totalActive: number
  stale: number
  lastConsolidatedAt: number | null
  lastActions: { update: number; merge: number; delete: number; skip: number; decayed: number } | null
  recentChanges: Record<string, MemoryChange>
}

export async function getMemoryConsolidationStats(agentId: string): Promise<ConsolidationStats> {
  return apiFetch<ConsolidationStats>(`/api/custom-agents/${encodeURIComponent(agentId)}/memories/stats`)
}

export async function triggerConsolidation(agentId: string): Promise<ConsolidationStats> {
  return apiFetch<ConsolidationStats>(`/api/custom-agents/${encodeURIComponent(agentId)}/memories/consolidate`, { method: "POST" })
}

export interface AgentSession {
  id: string
  title: string
  agent: string | null
  cost: number
  tokensInput: number
  tokensOutput: number
  timeCreated: number
  timeUpdated: number
  completedAt: number | null
}

export async function listAgentSessions(agentId: string): Promise<AgentSession[]> {
  return apiFetch<AgentSession[]>(`/api/custom-agents/${encodeURIComponent(agentId)}/sessions`)
}

export async function listRepoCustomAgents(repoId: string): Promise<CustomAgent[]> {
  return unwrapList<CustomAgent>(await apiFetch<unknown>(`${repoBase(repoId)}/custom-agents`))
}

export async function createRepoCustomAgent(repoId: string, data: { name: string; baseAgent: string; model?: string; variant?: string; systemPrompt?: string; systemPromptPosition?: number; fragmentIds?: string[] }): Promise<CustomAgent> {
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

// ---------------------------------------------------------------------------
// Tag API — /api/repos/:repoId/tags
// ---------------------------------------------------------------------------

export interface Tag {
  id: string
  repoId: string
  name: string
  color: string
  description: string | null
  createdAt: number
}

export interface Milestone {
  id: string
  repoId: string
  number: number
  title: string
  description: string | null
  state: "open" | "closed"
  dueOn: number | null
  openIssues: number
  closedIssues: number
  createdAt: number
  updatedAt: number
}

export async function listTags(repoId: string): Promise<Tag[]> {
  return unwrapList<Tag>(await apiFetch<unknown>(`${repoBase(repoId)}/tags`))
}

// ---------------------------------------------------------------------------
// Milestone API — /api/repos/:repoId/milestones
// ---------------------------------------------------------------------------

export async function listMilestones(repoId: string, state?: string): Promise<Milestone[]> {
  const params = state ? `?state=${encodeURIComponent(state)}` : ""
  return unwrapList<Milestone>(await apiFetch<unknown>(`${repoBase(repoId)}/milestones${params}`))
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
  mergeable: boolean | null
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

export interface PersistentPullRequest {
  id: string
  repoId: string
  number: number
  title: string
  body?: string | null
  state: string
  headBranch: string
  baseBranch: string
  labels?: Array<{ id: number; name: string; color: string }> | null
  htmlUrl?: string | null
  authorLogin?: string | null
  authorAvatar?: string | null
  assignees?: Array<{ login: string; avatar_url: string }> | null
  mergeable?: string | null
  draft: number
  commentCount: number
  additions?: number | null
  deletions?: number | null
  changedFilesCount?: number | null
  commitCount?: number | null
  diffStats?: Array<{ filename: string; status: string; additions: number; deletions: number }> | null
  createdAt: number
  updatedAt: number
  mergedAt?: number | null
}

export async function listPulls(repoId: string, state = "open"): Promise<PersistentPullRequest[]> {
  return unwrapList<PersistentPullRequest>(
    await apiFetch<unknown>(`${repoBase(repoId)}/pulls?state=${encodeURIComponent(state)}`),
  )
}

export async function syncPulls(repoId: string, state = "all"): Promise<{ synced: number }> {
  return apiFetch<{ synced: number }>(`${repoBase(repoId)}/pulls/sync`, {
    method: "POST",
    body: JSON.stringify({ state }),
  })
}

export async function getPull(repoId: string, number: number): Promise<PersistentPullRequest> {
  return apiFetch<PersistentPullRequest>(`${repoBase(repoId)}/pulls/${number}`)
}

export async function mergePull(repoId: string, prNumber: number): Promise<void> {
  await apiFetch<void>(`${repoBase(repoId)}/pulls/${prNumber}/merge`, { method: "POST" })
}

export async function listPrLinkedIssues(repoId: string, prNumber: number): Promise<Issue[]> {
  return unwrapList<Issue>(await apiFetch<unknown>(`${repoBase(repoId)}/pulls/${prNumber}/issues`))
}

export async function linkPrToIssue(repoId: string, prNumber: number, issueNumber: number): Promise<void> {
  await apiFetch<void>(`${repoBase(repoId)}/pulls/${prNumber}/issues`, {
    method: "POST",
    body: JSON.stringify({ issueNumber }),
  })
}

export async function unlinkPrFromIssue(repoId: string, prNumber: number, issueNumber: number): Promise<void> {
  await apiFetch<void>(`${repoBase(repoId)}/pulls/${prNumber}/issues/${issueNumber}`, { method: "DELETE" })
}

export async function listPullComments(repoId: string, prNumber: number): Promise<IssueComment[]> {
  return apiFetch<IssueComment[]>(`${repoBase(repoId)}/pulls/${prNumber}/comments`)
}

export async function listIssueComments(repoId: string, issueNumber: number): Promise<IssueComment[]> {
  return apiFetch<IssueComment[]>(`${repoBase(repoId)}/issues/${issueNumber}/comments`)
}

export async function createIssueComment(repoId: string, issueNumber: number, body: string): Promise<IssueComment> {
  return apiFetch<IssueComment>(`${repoBase(repoId)}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  })
}

export async function polishComment(repoId: string, issueNumber: number, draft: string): Promise<{ sessionId: string; draftPath: string }> {
  return apiFetch<{ sessionId: string; draftPath: string }>(`${repoBase(repoId)}/issues/${issueNumber}/polish`, {
    method: "POST",
    body: JSON.stringify({ draft }),
  })
}

export async function getDraft(repoId: string, issueNumber: number): Promise<{ body: string }> {
  return apiFetch<{ body: string }>(`${repoBase(repoId)}/issues/${issueNumber}/draft`)
}

export async function polishIssueCreate(repoId: string, title: string, body?: string): Promise<{ sessionId: string; draftPath: string }> {
  return apiFetch<{ sessionId: string; draftPath: string }>(`${repoBase(repoId)}/issues/polish-create`, {
    method: "POST",
    body: JSON.stringify({ title, body }),
  })
}

export async function getIssueCreateDraft(repoId: string): Promise<{ title: string; body: string }> {
  return apiFetch<{ title: string; body: string }>(`${repoBase(repoId)}/issues/draft-create`)
}

export async function deleteIssueCreateDraft(repoId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`${repoBase(repoId)}/issues/draft-create`, { method: "DELETE" })
}

export async function renameSession(repoId: string, sessionId: string, title: string): Promise<void> {
  await apiFetch<void>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "PATCH", body: JSON.stringify({ title }) },
  )
}

export async function updateSessionCompleted(repoId: string, sessionId: string, completedAt: number | null): Promise<void> {
  await apiFetch<void>(
    `${repoBase(repoId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "PATCH", body: JSON.stringify({ completedAt }) },
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

// ---------------------------------------------------------------------------
// Cloud Worker API — /api/cloud
// ---------------------------------------------------------------------------

export interface CloudStatus {
  mode: string
  masterUrl?: string
  workerId?: string
  connected?: boolean
  heldAccount?: { id: string; label: string }
  defaultWorkerId?: string
}

export async function getCloudStatus(): Promise<CloudStatus> {
  return apiFetch<CloudStatus>("/api/cloud/status")
}

export async function reloadCloudPool(): Promise<CloudStatus> {
  return apiFetch<CloudStatus>("/api/cloud/reload", { method: "POST" })
}

export async function testMasterConnection(url: string): Promise<boolean> {
  try {
    const res = await apiFetch<{ connected: boolean }>("/api/cloud/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
    return res.connected
  } catch {
    return false
  }
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
  holders?: string[]
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

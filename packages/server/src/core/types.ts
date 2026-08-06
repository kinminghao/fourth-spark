// ---------------------------------------------------------------------------
// Plugin interfaces — the extension points of Fourth Spark.
//
// Each interface is implemented incrementally:
//   Phase 1: NotificationChannel
//   Phase 2: McpToolProvider, GitPlatformFactory
//   Phase 3: AccountPool
//   Phase 4: AgentRuntime, AgentClient
//
// Until its Phase is complete, each interface is defined but not consumed.
// ---------------------------------------------------------------------------

import type { GitIssueClient, Platform } from "../lib/git-provider"

// --- Notification (Phase 1) ------------------------------------------------

export interface NotifyEvent {
  type: string
  title: string
  body: string
  sessionId?: string
  data?: Record<string, string>
}

export interface NotificationChannel {
  readonly id: string
  send(event: NotifyEvent): Promise<void>
  dispose?(): void
}

// --- MCP Tools (Phase 2) ---------------------------------------------------

export interface ToolContext {
  repoId: string
}

export interface McpToolProvider {
  readonly id: string
  /** Register tools onto the given MCP server instance. */
  register(server: unknown, context: ToolContext): void
}

// --- Git Platform (Phase 2) ------------------------------------------------

export interface GitPlatformFactory {
  readonly platform: Platform
  createClient(host: string, owner: string, repo: string, token: string): GitIssueClient
}

// --- Account Pool (Phase 3) ------------------------------------------------

export type AcquireResult =
  | { ok: true; accountId: string; credential: unknown; expiresAt?: number }
  | { ok: false; reason: string }

export interface AccountPool {
  acquire(ctx: { reason: string; currentAccountId?: string }): Promise<AcquireResult>
  reportLimit(ctx: { accountId: string; message: string }): Promise<void>
  release?(accountId: string): Promise<void>
  getActiveId(): Promise<string | undefined>
  dispose?(): void
}

// --- Agent Runtime (Phase 4) -----------------------------------------------

export interface SpawnConfig {
  repoId: string
  localPath: string
  port: number
}

export interface RuntimeHandle {
  pid: number
  port: number
  kill(): void
}

export interface AgentClient {
  readonly baseUrl: string
  readonly directory: string

  listSessions(): Promise<unknown[]>
  createSession(opts: { agent?: string; title?: string }): Promise<unknown>
  getSession(sessionId: string): Promise<unknown>
  deleteSession(sessionId: string): Promise<void>
  getMessages(sessionId: string): Promise<unknown[]>
  prompt(sessionId: string, content: string, opts?: Record<string, unknown>): Promise<void>
  abort(sessionId: string): Promise<void>
  getTodos(sessionId: string): Promise<unknown[]>
  getSessionStatus(): Promise<Record<string, { type: string }>>
  eventStream(signal?: AbortSignal): Promise<Response>
}

export interface AgentRuntime {
  readonly id: string
  spawn(config: SpawnConfig): Promise<RuntimeHandle>
  createClient(baseUrl: string, directory: string): AgentClient
  verify(port: number, directory: string): Promise<boolean>
  /** Apply credentials obtained from AccountPool. Runtime-specific. */
  applyCredential?(credential: unknown): Promise<void>
}

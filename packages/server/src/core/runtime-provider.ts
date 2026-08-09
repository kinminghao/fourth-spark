// ---------------------------------------------------------------------------
// RuntimeProvider — the runtime-specific lifecycle plugin. Each runtime
// (OpenCode, Claude Code CLI, ...) implements this interface once and hands it
// to the RuntimeManager. The manager routes repo lifecycle calls to the right
// provider.
// ---------------------------------------------------------------------------

import type { RuntimeClient } from "./runtime-client"
import type { CredentialWriter } from "./runtime-types"

export interface RuntimeHealth {
  reachable: boolean
  details?: Record<string, unknown>
}

export interface RuntimeProvider {
  readonly id: string
  readonly credentialWriter: CredentialWriter

  initialize(repoId: string, localPath: string): Promise<void>
  teardown(repoId: string): Promise<void>
  isReady(repoId: string): boolean
  getClient(repoId: string): RuntimeClient | null
  healthCheck(repoId: string): Promise<RuntimeHealth>
  injectMcp(localPath: string, repoId: string, serverPort: number): void
  removeMcp(localPath: string): void
  killAllSync(): void
}

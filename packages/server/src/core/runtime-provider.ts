// ---------------------------------------------------------------------------
// RuntimeProvider — the runtime-specific lifecycle plugin. Each runtime
// (OpenCode, Claude Code CLI, ...) implements this interface once and hands it
// to the RuntimeManager. The manager routes repo lifecycle calls to the right
// provider.
// ---------------------------------------------------------------------------

import type { ProviderId } from "../lib/auth-files"
import type { RuntimeClient } from "./runtime-client"
import type { CredentialWriter, RuntimeCredentialChannel } from "./runtime-types"

export interface RuntimeHealth {
  reachable: boolean
  details?: Record<string, unknown>
}

export interface RuntimeProvider {
  readonly id: string
  readonly credentialWriter: CredentialWriter
  readonly credentialChannel: RuntimeCredentialChannel
  /**
   * Account provider this runtime's push channel is bound to. Required for
   * runtime-push runtimes; account-store runtimes leave it unset.
   */
  readonly accountProvider?: ProviderId

  /** Re-read the shared credential store into live instance state. Only
   *  account-store runtimes implement it; callers treat it as best-effort. */
  refreshCredentials?(): Promise<void>

  initialize(repoId: string, localPath: string): Promise<void>
  teardown(repoId: string): Promise<void>
  isReady(repoId: string): boolean
  getClient(repoId: string): RuntimeClient | null
  healthCheck(repoId: string): Promise<RuntimeHealth>
  injectMcp(localPath: string, repoId: string, serverPort: number, sessionId?: string): void
  removeMcp(localPath: string): void
  killAllSync(): void
}

export function needsCredentialPush(provider: RuntimeProvider): boolean {
  return provider.credentialChannel === "runtime-push"
}

export function consumesCredentialProvider(provider: RuntimeProvider, accountProvider: ProviderId): boolean {
  return provider.credentialChannel === "runtime-push" && provider.accountProvider === accountProvider
}

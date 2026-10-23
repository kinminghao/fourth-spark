// ---------------------------------------------------------------------------
// Account provider contract — the descriptor every provider registers in the
// registry (./index.ts). Core account flows (switching, usage, leasing) resolve
// a descriptor by provider id instead of hardcoding provider-specific behavior.
// ---------------------------------------------------------------------------

import type { AuthToken, ProviderId, TokenWrite } from "../auth-files"

export type RefreshResult = { access: string; refresh: string; expires: number }

export type AuthorizeResult = { url: string; pendingId: string; expiresAt: number }

export type ExchangeResult =
  | { ok: true; id: string; label: string; existing: boolean }
  | {
      ok: false
      reason: "unknown-pending" | "expired" | "exhausted" | "exchange-failed" | "profile-failed" | "throttled"
      detail?: string
      attemptsLeft?: number
      retryAfterMs?: number
    }

export type ProfileResult = {
  uuid: string
  email: string
  displayName: string
  subscription?: Record<string, unknown>
}

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
  /** opencode-go month window. */
  monthly?: UsageWindow | null
  scoped?: ScopedUsageWindow[]
}

export interface OAuthCredentialAdapter {
  readonly kind: "oauth"
  read(): Promise<AuthToken | undefined>
  write(token: TokenWrite): Promise<void>
}

export interface ApiKeyCredentialAdapter {
  readonly kind: "api-key"
  read(): Promise<AuthToken | undefined>
  /**
   * For api-key adapters the durable secret is carried in `refresh` (the key):
   * `write({kind:"full",...})` writes the auth.json `{type:"api", key}` entry and
   * `lease` writes throw. read() maps the key into `{refresh: key, access: key}`
   * so core flows stay provider-agnostic.
   */
  write(token: TokenWrite): Promise<void>
  /**
   * Remove the stored credential (delete-account flow). Must not take the auth
   * lock itself (callers hold it).
   */
  clear(): Promise<void>
}

/**
 * A provider's credential store adapter. Discriminated by `kind` so callers that
 * need api-key-specific behavior (e.g. `clear()`) narrow exhaustively.
 */
export type CredentialAdapter = OAuthCredentialAdapter | ApiKeyCredentialAdapter

export interface RefreshStrategy {
  isStale(token: AuthToken, bufferMs?: number): boolean
  refresh(refreshToken: string): Promise<RefreshResult>
}

export interface UsageSource {
  fetch(access: string): Promise<UsageResponse>
}

export type ApiKeyVerifyResult =
  | { ok: true; id: string; label: string }
  | { ok: false; reason: "invalid-key" | "unreachable" | "unexpected"; detail?: string }

export interface OAuthLoginStrategy {
  readonly kind: "oauth"
  authorize(): AuthorizeResult
  exchange(pendingId: string, code: string): Promise<ExchangeResult>
}

export interface ApiKeyLoginStrategy {
  readonly kind: "api-key"
  verify(key: string): Promise<ApiKeyVerifyResult>
}

export type LoginStrategy = OAuthLoginStrategy | ApiKeyLoginStrategy

export interface IdentitySource {
  fetchProfile(access: string): Promise<ProfileResult>
}

export interface AccountProviderDescriptor {
  readonly id: ProviderId
  readonly label: string
  readonly credentialAdapter: CredentialAdapter
  readonly login: LoginStrategy
  readonly refresh: RefreshStrategy
  readonly usage: UsageSource
  /** Absent for providers with no profile endpoint (e.g. opencode-go). */
  readonly identity?: IdentitySource
}

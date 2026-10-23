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
  scoped?: ScopedUsageWindow[]
}

export interface CredentialAdapter {
  read(): Promise<AuthToken | undefined>
  write(token: TokenWrite): Promise<void>
}

export interface RefreshStrategy {
  isStale(token: AuthToken, bufferMs?: number): boolean
  refresh(refreshToken: string): Promise<RefreshResult>
}

export interface UsageSource {
  fetch(access: string): Promise<UsageResponse>
}

export interface LoginStrategy {
  authorize(): AuthorizeResult
  exchange(pendingId: string, code: string): Promise<ExchangeResult>
}

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
  readonly identity: IdentitySource
}

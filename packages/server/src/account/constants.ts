import type { ProviderId } from "../lib/auth-files"

export const ACCOUNT_POOL_DEFAULT_PORT = 8787
export const ACCOUNT_POOL_DEFAULT_HOST = "127.0.0.1"
export const ACCOUNT_POOL_PROTOCOL_VERSION = 2

export type ProviderPoolLimits = {
  maxHolders: number
  leaseTtlMs?: number
}

const PROVIDER_LIMITS: Record<ProviderId, ProviderPoolLimits> = {
  anthropic: { maxHolders: 3 },
  openai: { maxHolders: 1 },
  "opencode-go": { maxHolders: 1, leaseTtlMs: 4 * 60 * 60_000 },
}

const FALLBACK_LIMITS: ProviderPoolLimits = { maxHolders: 1, leaseTtlMs: 4 * 60 * 60_000 }

export function providerPoolLimits(provider: ProviderId): ProviderPoolLimits {
  return PROVIDER_LIMITS[provider] ?? FALLBACK_LIMITS
}

export const ACCOUNT_POOL_MIN_LEASE_REMAINING_MS = 30_000

export const ACCOUNT_POOL_API_KEY_LEASE_TTL_MS = 4 * 60 * 60_000
export const ACCOUNT_POOL_REFRESH_MIN_REMAINING_MS = 15 * 60_000
export const ACCOUNT_POOL_LEASE_MARGIN_MS = 10 * 60_000
export const ACCOUNT_POOL_DEFAULT_COOLDOWN_MS = 30 * 60_000
export const ACCOUNT_POOL_AFFINITY_TTL_MS = 24 * 60 * 60_000
export const ACCOUNT_POOL_ADOPTION_GRACE_MS = 15_000
export const ACCOUNT_POOL_USAGE_REFRESH_THROTTLE_MS = 30_000
export const ACCOUNT_POOL_STATE_VERSION = 1

// ---------------------------------------------------------------------------
// Anthropic (Claude) account provider — descriptor plus the Anthropic usage
// endpoint. Login, token refresh and identity extraction delegate to the
// existing Claude modules.
// ---------------------------------------------------------------------------

import { authorize, exchange, fetchProfile } from "../claude-onboard"
import { isStale, refreshToken } from "../token-refresh"
import { createAuthJsonCredentialAdapter } from "./auth-json"
import type { AccountProviderDescriptor, ScopedUsageWindow, UsageResponse } from "./types"

const PROVIDER_ID = "anthropic"

const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage"
const OAUTH_BETA = "oauth-2025-04-20"
const NETWORK_TIMEOUT_MS = 15_000

interface RawLimit {
  kind?: string
  percent?: unknown
  resets_at?: unknown
  scope?: { model?: { display_name?: unknown } | null } | null
}

function scopedFromLimits(limits: unknown): ScopedUsageWindow[] | undefined {
  if (!Array.isArray(limits)) return undefined
  const out: ScopedUsageWindow[] = []
  for (const raw of limits as RawLimit[]) {
    if (raw?.kind !== "weekly_scoped") continue
    const label = raw.scope?.model?.display_name
    if (typeof label !== "string" || label.length === 0) continue
    if (typeof raw.percent !== "number" || !Number.isFinite(raw.percent)) continue
    const resets_at = typeof raw.resets_at === "string" ? raw.resets_at : undefined
    out.push({ label, utilization: raw.percent, resets_at })
  }
  return out.length > 0 ? out : undefined
}

async function fetchUsage(access: string): Promise<UsageResponse> {
  const res = await fetch(USAGE_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${access}`,
      "anthropic-beta": OAUTH_BETA,
    },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`usage request failed (${res.status})`)
  }
  const usage = (await res.json()) as UsageResponse & { limits?: unknown }
  const scoped = scopedFromLimits(usage.limits)
  if (scoped) usage.scoped = scoped
  return usage
}

export const anthropicAccountProvider: AccountProviderDescriptor = {
  id: PROVIDER_ID,
  label: "Claude",
  credentialAdapter: createAuthJsonCredentialAdapter(PROVIDER_ID),
  login: { kind: "oauth", authorize, exchange },
  refresh: { isStale, refresh: refreshToken },
  usage: { fetch: fetchUsage },
  identity: { fetchProfile },
}

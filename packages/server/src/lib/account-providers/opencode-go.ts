// ---------------------------------------------------------------------------
// OpenCode Go account provider — static api-key accounts served by the OpenCode
// inference gateway. There is no OAuth flow and no profile endpoint; the key is
// verified against the models endpoint and usage comes from the zen usage API.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto"
import { createAuthJsonApiKeyAdapter } from "./auth-json"
import type { AccountProviderDescriptor, ApiKeyVerifyResult, UsageResponse, UsageWindow } from "./types"

const PROVIDER_ID = "opencode-go"

const MODELS_ENDPOINT = "https://opencode.ai/inference/go/v1/models"
const USAGE_ENDPOINT = "https://opencode.ai/zen/go/v1/usage"
const NETWORK_TIMEOUT_MS = 15_000

interface RawUsageWindow {
  percent?: unknown
  resetsAt?: unknown
}

interface RawUsage {
  rolling?: RawUsageWindow
  weekly?: RawUsageWindow
  monthly?: RawUsageWindow
}

async function verifyApiKey(rawKey: string): Promise<ApiKeyVerifyResult> {
  const key = rawKey.trim()
  if (key.length === 0) return { ok: false, reason: "invalid-key" }

  let res: Response
  try {
    res = await fetch(MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    })
  } catch (err) {
    return { ok: false, reason: "unreachable", detail: err instanceof Error ? err.message : String(err) }
  }

  if (res.status === 401 || res.status === 403) return { ok: false, reason: "invalid-key" }
  if (!res.ok) return { ok: false, reason: "unexpected", detail: `HTTP ${res.status}` }

  return {
    ok: true,
    id: createHash("sha256").update(key).digest("hex").slice(0, 16),
    label: `OpenCode Go · ${key.slice(-4)}`,
  }
}

function toWindow(raw: RawUsageWindow | undefined): UsageWindow | undefined {
  if (!raw || typeof raw.percent !== "number" || !Number.isFinite(raw.percent)) return undefined
  const resets_at = typeof raw.resetsAt === "string" ? raw.resetsAt : undefined
  return { utilization: raw.percent, resets_at }
}

async function fetchUsage(key: string): Promise<UsageResponse> {
  const res = await fetch(USAGE_ENDPOINT, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`usage request failed (${res.status})`)

  let body: { usage?: RawUsage }
  try {
    body = (await res.json()) as { usage?: RawUsage }
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error("usage response was not valid JSON")
    throw err
  }

  const raw = body.usage
  if (!raw || typeof raw !== "object") throw new Error("usage response missing usage object")

  const result: UsageResponse = {}
  const fiveHour = toWindow(raw.rolling)
  if (fiveHour) result.five_hour = fiveHour
  const sevenDay = toWindow(raw.weekly)
  if (sevenDay) result.seven_day = sevenDay
  const monthly = toWindow(raw.monthly)
  if (monthly) result.monthly = monthly
  return result
}

export const openCodeGoAccountProvider: AccountProviderDescriptor = {
  id: PROVIDER_ID,
  label: "OpenCode Go",
  credentialAdapter: createAuthJsonApiKeyAdapter(PROVIDER_ID),
  login: { kind: "api-key", verify: verifyApiKey },
  refresh: {
    isStale: () => false,
    refresh: async () => {
      throw new Error("opencode-go credentials do not refresh")
    },
  },
  usage: { fetch: fetchUsage },
}

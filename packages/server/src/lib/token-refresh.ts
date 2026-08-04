import { logger } from "../middleware/logger"
import { isWorkerMode } from "./config"

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
const NETWORK_TIMEOUT_MS = 15_000
const REFRESH_429_COOLDOWN_MS = 5 * 60_000

export const TOKEN_EXPIRY_BUFFER_MS = 60_000

export type RefreshResult = { access: string; refresh: string; expires: number }

export class RefreshRevokedError extends Error {
  readonly revoked = true as const
  constructor(readonly refresh: string) {
    super("refresh token revoked (invalid_grant)")
    this.name = "RefreshRevokedError"
  }
}

function isInvalidGrant(body: string): boolean {
  try {
    return (JSON.parse(body) as { error?: string }).error === "invalid_grant"
  } catch {
    return false
  }
}

const inflightRefresh = new Map<string, Promise<RefreshResult>>()
const refresh429Cooldown = new Map<string, number>()

export function isRefresh429Cooldown(refresh: string): boolean {
  const until = refresh429Cooldown.get(refresh)
  if (!until) return false
  if (Date.now() >= until) {
    refresh429Cooldown.delete(refresh)
    return false
  }
  return true
}

async function doRefreshToken(refresh: string): Promise<RefreshResult> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "User-Agent": "axios/1.13.6",
    },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refresh, client_id: CLIENT_ID }),
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    if (res.status === 429) {
      refresh429Cooldown.set(refresh, Date.now() + REFRESH_429_COOLDOWN_MS)
      logger.warn("token-refresh: 429 cooldown activated")
    }
    if (res.status === 400 && isInvalidGrant(body)) {
      throw new RefreshRevokedError(refresh)
    }
    throw new Error(`token refresh failed (${res.status})`)
  }

  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
  }
}

export function refreshToken(refresh: string): Promise<RefreshResult> {
  if (isWorkerMode()) throw new Error("worker mode must not refresh tokens locally — lease from master instead")
  const existing = inflightRefresh.get(refresh)
  if (existing) return existing
  const promise = doRefreshToken(refresh).finally(() => {
    inflightRefresh.delete(refresh)
  })
  inflightRefresh.set(refresh, promise)
  return promise
}

export function isStale(token: { access?: string; expires?: number }, bufferMs = TOKEN_EXPIRY_BUFFER_MS): boolean {
  return !token.access || !token.expires || token.expires < Date.now() + bufferMs
}

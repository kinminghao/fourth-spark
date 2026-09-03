// ---------------------------------------------------------------------------
// Claude OAuth PKCE onboarding — lets users add Claude accounts via the Web UI.
//
// Flow: Server generates PKCE verifier + authorize URL → user opens URL in
// browser, logs into Claude, copies the authorization code → pastes it back
// → Server exchanges code for tokens → fetches profile → upserts into the
// account pool.
//
// The PKCE verifier NEVER leaves this process. The browser receives only a
// pendingId handle.
// ---------------------------------------------------------------------------

import { createHash, randomBytes } from "node:crypto"
import { logger } from "../middleware/logger"
import {
  loadAccounts,
  saveAccounts,
  writeAuthAnthropic,
  withAuthLock,
  applyToken,
  type StoredAccount,
} from "./auth-files"

// ---------------------------------------------------------------------------
// Constants — aligned with Claude Code CLI / claude-accounts-pool
// ---------------------------------------------------------------------------

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"
const SCOPES = "org:create_api_key user:profile user:inference"
const PROFILE_ENDPOINT = "https://api.anthropic.com/api/oauth/profile"
const OAUTH_BETA = "oauth-2025-04-20"
const NETWORK_TIMEOUT_MS = 15_000

// Safety limits (aligned with claude-accounts-pool's accountOnboard.ts)
const MAX_PENDING = 4
const PENDING_TTL_MS = 10 * 60_000
const MAX_ATTEMPTS = 3
const MIN_INTERVAL_MS = 3_000

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash("sha256").update(verifier).digest())
  return { verifier, challenge }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Pending = {
  verifier: string
  state: string
  expiresAt: number
  attempts: number
}

export type AuthorizeResult = {
  url: string
  pendingId: string
  expiresAt: number
}

export type ExchangeResult =
  | { ok: true; id: string; label: string; existing: boolean }
  | { ok: false; reason: "unknown-pending" | "expired" | "exhausted" | "exchange-failed" | "profile-failed" | "throttled"; detail?: string; attemptsLeft?: number; retryAfterMs?: number }

type ProfileResult = {
  uuid: string
  email: string
  displayName: string
  subscription?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Onboard service (singleton)
// ---------------------------------------------------------------------------

const pendings = new Map<string, Pending>()
let lastAttemptAt = 0

function prune(): void {
  const now = Date.now()
  for (const [id, p] of pendings) {
    if (p.expiresAt <= now) pendings.delete(id)
  }
}

export function authorize(): AuthorizeResult {
  prune()

  // Evict oldest if at capacity
  while (pendings.size >= MAX_PENDING) {
    const oldest = pendings.keys().next()
    if (oldest.done) break
    pendings.delete(oldest.value)
    logger.info("claude-onboard: evicted oldest pending session")
  }

  const { verifier, challenge } = generatePKCE()
  const state = base64url(randomBytes(16))
  const pendingId = base64url(randomBytes(16))
  const expiresAt = Date.now() + PENDING_TTL_MS

  const url = `${AUTHORIZE_URL}?${new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString()}`

  pendings.set(pendingId, { verifier, state, expiresAt, attempts: 0 })
  logger.info({ pendingId, expiresAt, pendings: pendings.size }, "claude-onboard: session started")

  return { url, pendingId, expiresAt }
}

export async function exchange(pendingId: string, code: string): Promise<ExchangeResult> {
  // Lookup BEFORE prune so we can distinguish expired from unknown
  const pending = pendings.get(pendingId)
  prune()

  if (!pending) {
    return { ok: false, reason: "unknown-pending" }
  }
  if (pending.expiresAt <= Date.now()) {
    pendings.delete(pendingId)
    return { ok: false, reason: "expired" }
  }
  if (pending.attempts >= MAX_ATTEMPTS) {
    pendings.delete(pendingId)
    return { ok: false, reason: "exhausted" }
  }

  // Throttle
  const elapsed = Date.now() - lastAttemptAt
  if (elapsed < MIN_INTERVAL_MS) {
    const retryAfterMs = MIN_INTERVAL_MS - elapsed
    return { ok: false, reason: "throttled", retryAfterMs }
  }

  lastAttemptAt = Date.now()
  pending.attempts += 1

  // Exchange authorization code for tokens
  let tokenRes: Response
  try {
    tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: CLIENT_ID,
        code_verifier: pending.verifier,
        redirect_uri: REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn({ pendingId, error: msg }, "claude-onboard: exchange network error")
    const attemptsLeft = MAX_ATTEMPTS - pending.attempts
    if (attemptsLeft <= 0) {
      pendings.delete(pendingId)
      return { ok: false, reason: "exhausted" }
    }
    return { ok: false, reason: "exchange-failed", detail: msg, attemptsLeft }
  }

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "")
    logger.warn({ pendingId, status: tokenRes.status }, "claude-onboard: exchange failed")
    const attemptsLeft = MAX_ATTEMPTS - pending.attempts
    if (attemptsLeft <= 0) {
      pendings.delete(pendingId)
      return { ok: false, reason: "exhausted" }
    }
    return { ok: false, reason: "exchange-failed", detail: `HTTP ${tokenRes.status}: ${body.slice(0, 200)}`, attemptsLeft }
  }

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }

  if (!tokenJson.access_token || !tokenJson.refresh_token) {
    pendings.delete(pendingId)
    return { ok: false, reason: "exchange-failed", detail: "response missing tokens" }
  }

  // Authorization code is single-use — session is spent regardless of what follows
  pendings.delete(pendingId)

  const accessToken = tokenJson.access_token
  const refreshToken = tokenJson.refresh_token
  const expiresAt = Date.now() + (tokenJson.expires_in ?? 28800) * 1000

  // Fetch profile to identify the account
  let profile: ProfileResult
  try {
    profile = await fetchProfile(accessToken)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn({ pendingId, error: msg }, "claude-onboard: profile fetch failed")
    return { ok: false, reason: "profile-failed", detail: msg }
  }

  // Upsert into account pool + write auth.json
  const existing = await upsertAccount(profile.uuid, profile.email, {
    refresh: refreshToken,
    access: accessToken,
    expires: expiresAt,
  }, profile.subscription)

  // Write auth.json so the runtime picks it up immediately
  await writeAuthAnthropic({
    kind: "full",
    refresh: refreshToken,
    access: accessToken,
    expires: expiresAt,
  })

  // Broadcast to other runtimes
  try {
    const { getRegistry } = await import("../core/registry")
    for (const provider of getRegistry().providers.values()) {
      if (provider.id === "opencode") continue
      await provider.credentialWriter.write({
        kind: "full",
        refresh: refreshToken,
        access: accessToken,
        expires: expiresAt,
      }).catch(() => {})
    }
  } catch {}

  logger.info({ uuid: profile.uuid, label: profile.email, existing }, "claude-onboard: account added")

  return {
    ok: true,
    id: profile.uuid,
    label: profile.email,
    existing,
  }
}

// ---------------------------------------------------------------------------
// Account removal
// ---------------------------------------------------------------------------

export async function removeAccount(id: string): Promise<{ ok: true; label: string } | { ok: false; reason: string }> {
  return withAuthLock(async () => {
    const file = await loadAccounts()
    const index = file.accounts.findIndex((a) => a.id === id)
    if (index < 0) return { ok: false, reason: "account not found" }
    if (file.activeId === id) return { ok: false, reason: "cannot remove active account" }

    const [removed] = file.accounts.splice(index, 1)
    if (file.activeId === id) file.activeId = undefined
    await saveAccounts(file)

    logger.info({ id, label: removed.label }, "claude-onboard: account removed")
    return { ok: true, label: removed.label }
  })
}

// ---------------------------------------------------------------------------
// Profile fetch
// ---------------------------------------------------------------------------

async function fetchProfile(access: string): Promise<ProfileResult> {
  const res = await fetch(PROFILE_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${access}`,
      "anthropic-beta": OAUTH_BETA,
    },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`profile request failed (${res.status})`)
  }
  const json = (await res.json()) as {
    account?: { uuid?: string; email?: string; display_name?: string; full_name?: string }
    organization?: Record<string, unknown>
  }
  const account = json.account
  if (!account?.uuid) {
    throw new Error("profile response missing account uuid")
  }
  return {
    uuid: account.uuid,
    email: account.email ?? account.uuid,
    displayName: account.display_name ?? account.full_name ?? account.email ?? account.uuid,
    subscription: json.organization && typeof json.organization === "object" ? json.organization : undefined,
  }
}

// ---------------------------------------------------------------------------
// Upsert account into claude-accounts.json
// ---------------------------------------------------------------------------

async function upsertAccount(
  id: string,
  label: string,
  token: { refresh: string; access?: string; expires?: number },
  subscription?: Record<string, unknown>,
): Promise<boolean> {
  return withAuthLock(async () => {
    const file = await loadAccounts()
    const index = file.accounts.findIndex((a) => a.id === id)
    const existing = index >= 0

    if (existing) {
      applyToken(file.accounts[index], token)
      if (subscription) file.accounts[index].subscription = subscription
    } else {
      const newAccount: StoredAccount = {
        id,
        label,
        refresh: token.refresh,
        access: token.access,
        expires: token.expires,
        subscription,
      }
      file.accounts.push(newAccount)
    }

    // Set as active
    file.activeId = id
    await saveAccounts(file)

    logger.info({ id, label, existing }, "claude-onboard: account upserted")
    return existing
  })
}

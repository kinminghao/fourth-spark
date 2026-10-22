// ---------------------------------------------------------------------------
// OpenAI (ChatGPT) account provider — browser OAuth with a fixed loopback
// callback listener, plus a headless device-code flow. The credential is the
// opencode `openai` auth.json entry:
// `{type:"oauth",access,refresh,expires,accountId}`. ChatGPT has no public
// usage API, so the descriptor intentionally has no usage source.
// ---------------------------------------------------------------------------

import { createHash, randomBytes } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { upsertAccountWithCredential } from "../claude-onboard"
import { createAuthJsonCredentialAdapter } from "./auth-json"
import type {
  AccountProviderDescriptor,
  AuthorizeResult,
  CallbackLoginState,
  DeviceAuthorizeResult,
  ExchangeResult,
  RefreshResult,
} from "./types"

const PROVIDER_ID = "openai"
const PROVIDER_LABEL = "OpenAI (ChatGPT)"

const ISSUER = "https://auth.openai.com"
const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`
const TOKEN_URL = `${ISSUER}/oauth/token`
const DEVICE_REQUEST_URL = `${ISSUER}/api/accounts/deviceauth/usercode`
const DEVICE_TOKEN_URL = `${ISSUER}/api/accounts/deviceauth/token`
const DEVICE_VERIFICATION_URL = `${ISSUER}/codex/device`
const DEVICE_REDIRECT_URI = `${ISSUER}/deviceauth/callback`
const DEVICE_USER_AGENT = "fourth-spark"
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"

const CALLBACK_PORT = 1455
const CALLBACK_PATH = "/auth/callback"
const SCOPE = "openid profile email offline_access"

const NETWORK_TIMEOUT_MS = 15_000
const PENDING_TTL_MS = 10 * 60_000
const COMPLETED_TTL_MS = 5 * 60_000
const DEVICE_DEFAULT_TTL_MS = 15 * 60_000
const DEVICE_POLL_GRACE_MS = 1_000
const MAX_ACTIVE_LOGIN = 1

const STALE_BUFFER_MS = 5 * 60_000

type IssuedToken = {
  access: string
  refresh: string
  expires: number
  idToken?: string
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
}

type Pending = {
  pendingId: string
  verifier: string
  state: string
  expiresAt: number
  url: string
  redirectUri: string
  server: Server
  status: "pending" | "complete"
  result?: ExchangeResult
  completedAt?: number
  processing?: boolean
}

type DevicePending = {
  pendingId: string
  deviceAuthId: string
  userCode: string
  intervalMs: number
  expiresAt: number
  nextPollAt: number
  status: "pending" | "complete"
  result?: ExchangeResult
  completedAt?: number
  polling?: boolean
}

type DeviceAuthorizeResponse = {
  device_auth_id?: string
  user_code?: string
  interval?: string
  expires_at?: string
}

type DeviceTokenResponse = {
  authorization_code?: string
  code_verifier?: string
}

type Identity = { accountId: string; email?: string }

const pendingLogins = new Map<string, Pending>()
const devicePendingLogins = new Map<string, DevicePending>()

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash("sha256").update(verifier).digest())
  return { verifier, challenge }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined
  const parts = token.split(".")
  if (parts.length < 2) return undefined
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
    const parsed: unknown = JSON.parse(Buffer.from(padded, "base64").toString("utf8"))
    return asRecord(parsed)
  } catch {
    return undefined
  }
}

function accountIdFromClaims(claims: Record<string, unknown> | undefined): string | undefined {
  if (!claims) return undefined
  const direct = nonEmptyString(claims.chatgpt_account_id)
  if (direct) return direct

  const authClaim = asRecord(claims["https://api.openai.com/auth"])
  const nested = nonEmptyString(authClaim?.chatgpt_account_id)
  if (nested) return nested

  const organizations = claims.organizations
  if (Array.isArray(organizations)) {
    for (const organization of organizations) {
      const id = nonEmptyString(asRecord(organization)?.id)
      if (id) return id
    }
  }
  return undefined
}

function extractIdentity(idToken: string | undefined, accessToken: string): Identity | undefined {
  const idClaims = decodeJwtPayload(idToken)
  const accessClaims = decodeJwtPayload(accessToken)
  const accountId = accountIdFromClaims(idClaims) ?? accountIdFromClaims(accessClaims)
  if (!accountId) return undefined
  const email =
    nonEmptyString(idClaims?.email) ??
    nonEmptyString(accessClaims?.email) ??
    nonEmptyString(asRecord(idClaims?.profile)?.email) ??
    nonEmptyString(asRecord(accessClaims?.profile)?.email)
  return { accountId, email }
}

function closeListener(server: Server): void {
  try {
    server.close()
  } catch {
    // Listener already closed.
  }
  server.closeAllConnections?.()
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

function respondHtml(res: ServerResponse, status: number, title: string, detail?: string, onDone?: () => void): void {
  const detailHtml = detail ? `<p>${escapeHtml(detail)}</p>` : ""
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family: system-ui, sans-serif; padding: 2rem;"><h2>${escapeHtml(title)}</h2>${detailHtml}</body></html>`
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
  res.end(body, onDone)
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening)
      reject(err)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(port, "127.0.0.1")
  })
}

function pruneSessions(): void {
  const now = Date.now()
  for (const [id, pending] of pendingLogins) {
    if (pending.status === "complete") {
      if (pending.completedAt !== undefined && now - pending.completedAt >= COMPLETED_TTL_MS) {
        pendingLogins.delete(id)
      }
      continue
    }
    if (pending.expiresAt <= now) {
      pendingLogins.delete(id)
      closeListener(pending.server)
    }
  }
}

function completePending(pending: Pending, result: ExchangeResult): void {
  pending.status = "complete"
  pending.result = result
  pending.completedAt = Date.now()
}

function buildAuthorizeUrl(input: { redirectUri: string; state: string; challenge: string }): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: SCOPE,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    state: input.state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "opencode",
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<IssuedToken> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`token exchange failed (HTTP ${res.status}): ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as TokenResponse
  if (!json.access_token || !json.refresh_token) {
    throw new Error("token response missing access or refresh token")
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + (json.expires_in ?? 3600) * 1000,
    idToken: json.id_token,
  }
}

async function completeLogin(token: IssuedToken): Promise<ExchangeResult> {
  const identity = extractIdentity(token.idToken, token.access)
  if (!identity) {
    return { ok: false, reason: "profile-failed", detail: "token response missing account id" }
  }

  const label = identity.email ?? `ChatGPT · ${identity.accountId.slice(-6)}`
  const existing = await upsertAccountWithCredential(PROVIDER_ID, identity.accountId, label, {
    refresh: token.refresh,
    access: token.access,
    expires: token.expires,
    accountId: identity.accountId,
  })

  const { invalidateUsageCache } = await import("../claude-usage")
  invalidateUsageCache(PROVIDER_ID)
  const { runtimeManager } = await import("../process-manager")
  const { refreshAccountStoreRuntimes } = await import("../credential-refresh")
  await refreshAccountStoreRuntimes(runtimeManager.listProviders())

  return { ok: true, id: identity.accountId, label, existing }
}

async function exchangeAndUpsert(pending: Pending, code: string): Promise<ExchangeResult> {
  const token = await exchangeCode(code, pending.verifier, pending.redirectUri)
  return completeLogin(token)
}

async function handleCallback(req: IncomingMessage, res: ServerResponse, pendingId: string): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  if (req.method !== "GET" || url.pathname !== CALLBACK_PATH) {
    respondHtml(res, 404, "未找到")
    return
  }

  const pending = pendingLogins.get(pendingId)
  if (!pending || pending.status !== "pending") {
    respondHtml(res, 400, "登录会话已失效")
    return
  }

  const error = url.searchParams.get("error")
  if (error) {
    const detail = url.searchParams.get("error_description") ?? error
    completePending(pending, { ok: false, reason: "exchange-failed", detail })
    respondHtml(res, 400, "授权失败", detail, () => closeListener(pending.server))
    return
  }

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || state !== pending.state) {
    respondHtml(res, 400, "回调参数无效", "缺少授权码或 state 不匹配")
    return
  }

  if (pending.processing) {
    respondHtml(res, 400, "正在处理", "请勿重复提交")
    return
  }
  pending.processing = true

  let result: ExchangeResult
  try {
    result = await exchangeAndUpsert(pending, code)
  } catch (err) {
    result = {
      ok: false,
      reason: "exchange-failed",
      detail: err instanceof Error ? err.message : String(err),
    }
  }

  completePending(pending, result)
  if (result.ok) {
    respondHtml(res, 200, "登录成功", "可以关闭此页面并返回 Fourth Spark。", () => closeListener(pending.server))
  } else {
    respondHtml(res, 400, "登录失败", result.detail, () => closeListener(pending.server))
  }
}

export async function startOpenAiLogin(port = CALLBACK_PORT): Promise<AuthorizeResult> {
  pruneSessions()

  const activeLogins = [...pendingLogins.values()].filter((pending) => pending.status === "pending")
  if (activeLogins.length >= MAX_ACTIVE_LOGIN) {
    const pending = activeLogins[0]
    return { url: pending.url, pendingId: pending.pendingId, expiresAt: pending.expiresAt }
  }

  const { verifier, challenge } = generatePkce()
  const state = base64url(randomBytes(16))
  const pendingId = base64url(randomBytes(16))
  const server = createServer((req, res) => {
    void handleCallback(req, res, pendingId)
  })

  try {
    await listen(server, port)
  } catch (err) {
    closeListener(server)
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`failed to start OpenAI callback listener on port ${port}: ${detail}`)
  }

  const address = server.address()
  if (!address || typeof address === "string") {
    closeListener(server)
    throw new Error("failed to resolve OpenAI callback listener address")
  }

  const redirectUri = `http://localhost:${address.port}${CALLBACK_PATH}`
  const url = buildAuthorizeUrl({ redirectUri, state, challenge })
  const expiresAt = Date.now() + PENDING_TTL_MS
  pendingLogins.set(pendingId, {
    pendingId,
    verifier,
    state,
    expiresAt,
    url,
    redirectUri,
    server,
    status: "pending",
  })

  return { url, pendingId, expiresAt }
}

export async function cancelOpenAiLogin(pendingId: string): Promise<void> {
  const pending = pendingLogins.get(pendingId)
  if (!pending) return
  pendingLogins.delete(pendingId)
  closeListener(pending.server)
}

export async function pollOpenAiLogin(pendingId: string): Promise<CallbackLoginState | undefined> {
  const pending = pendingLogins.get(pendingId)
  if (!pending) return undefined

  if (pending.status === "complete") {
    if (pending.completedAt !== undefined && Date.now() - pending.completedAt >= COMPLETED_TTL_MS) {
      pendingLogins.delete(pendingId)
      return undefined
    }
    return pending.result ? { state: "complete", result: pending.result } : undefined
  }

  if (pending.expiresAt <= Date.now()) {
    pendingLogins.delete(pendingId)
    closeListener(pending.server)
    return { state: "complete", result: { ok: false, reason: "expired" } }
  }

  return { state: "pending" }
}

function pruneDeviceSessions(): void {
  const now = Date.now()
  for (const [id, pending] of devicePendingLogins) {
    if (pending.completedAt !== undefined && now - pending.completedAt >= COMPLETED_TTL_MS) {
      devicePendingLogins.delete(id)
    }
  }
}

function deviceExpiresAt(raw: string | undefined): number {
  if (raw) {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed) && parsed > Date.now()) return parsed
  }
  return Date.now() + DEVICE_DEFAULT_TTL_MS
}

function completeDevice(pending: DevicePending, result: ExchangeResult): CallbackLoginState {
  pending.status = "complete"
  pending.result = result
  pending.completedAt = Date.now()
  return { state: "complete", result }
}

export async function startOpenAiDeviceLogin(): Promise<DeviceAuthorizeResult> {
  pruneDeviceSessions()

  const active = [...devicePendingLogins.values()].find((pending) => pending.status === "pending")
  if (active) {
    if (active.expiresAt > Date.now()) {
      return {
        url: DEVICE_VERIFICATION_URL,
        userCode: active.userCode,
        pendingId: active.pendingId,
        expiresAt: active.expiresAt,
        intervalMs: active.intervalMs,
      }
    }
    devicePendingLogins.delete(active.pendingId)
  }

  let res: Response
  try {
    res = await fetch(DEVICE_REQUEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": DEVICE_USER_AGENT,
      },
      body: JSON.stringify({ client_id: CLIENT_ID }),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    })
  } catch (err) {
    throw new Error(`device authorization request failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`device authorization failed (HTTP ${res.status}): ${body.slice(0, 200)}`)
  }

  let json: DeviceAuthorizeResponse
  try {
    json = (await res.json()) as DeviceAuthorizeResponse
  } catch {
    throw new Error("device authorization response was not valid JSON")
  }
  if (!json.device_auth_id || !json.user_code) {
    throw new Error("device authorization response missing device_auth_id or user_code")
  }

  const parsedInterval = Number.parseInt(json.interval ?? "5", 10)
  const intervalMs = Math.max(Number.isFinite(parsedInterval) ? parsedInterval : 5, 1) * 1000
  const expiresAt = deviceExpiresAt(json.expires_at)
  const pendingId = base64url(randomBytes(16))
  devicePendingLogins.set(pendingId, {
    pendingId,
    deviceAuthId: json.device_auth_id,
    userCode: json.user_code,
    intervalMs,
    expiresAt,
    nextPollAt: Date.now() + intervalMs + DEVICE_POLL_GRACE_MS,
    status: "pending",
  })

  return {
    url: DEVICE_VERIFICATION_URL,
    userCode: json.user_code,
    pendingId,
    expiresAt,
    intervalMs,
  }
}

export async function cancelOpenAiDeviceLogin(pendingId: string): Promise<void> {
  devicePendingLogins.delete(pendingId)
}

export async function pollOpenAiDeviceLogin(pendingId: string): Promise<CallbackLoginState | undefined> {
  const pending = devicePendingLogins.get(pendingId)
  if (!pending) return undefined

  if (pending.status === "complete") {
    if (pending.completedAt !== undefined && Date.now() - pending.completedAt >= COMPLETED_TTL_MS) {
      devicePendingLogins.delete(pendingId)
      return undefined
    }
    return pending.result ? { state: "complete", result: pending.result } : undefined
  }

  if (pending.expiresAt <= Date.now()) {
    devicePendingLogins.delete(pendingId)
    return { state: "complete", result: { ok: false, reason: "expired" } }
  }

  if (pending.polling || Date.now() < pending.nextPollAt) return { state: "pending" }

  pending.polling = true
  try {
    let res: Response
    try {
      res = await fetch(DEVICE_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": DEVICE_USER_AGENT,
        },
        body: JSON.stringify({ device_auth_id: pending.deviceAuthId, user_code: pending.userCode }),
        signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      })
    } catch (err) {
      return completeDevice(pending, {
        ok: false,
        reason: "exchange-failed",
        detail: err instanceof Error ? err.message : String(err),
      })
    }

    if (res.status === 403 || res.status === 404) {
      pending.nextPollAt = Date.now() + pending.intervalMs + DEVICE_POLL_GRACE_MS
      return { state: "pending" }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return completeDevice(pending, {
        ok: false,
        reason: "exchange-failed",
        detail: `device authorization failed (HTTP ${res.status}): ${body.slice(0, 200)}`,
      })
    }

    let json: DeviceTokenResponse
    try {
      json = (await res.json()) as DeviceTokenResponse
    } catch {
      return completeDevice(pending, {
        ok: false,
        reason: "exchange-failed",
        detail: "device authorization response was not valid JSON",
      })
    }
    if (!json.authorization_code || !json.code_verifier) {
      return completeDevice(pending, {
        ok: false,
        reason: "exchange-failed",
        detail: "device authorization response missing code or verifier",
      })
    }

    const token = await exchangeCode(json.authorization_code, json.code_verifier, DEVICE_REDIRECT_URI)
    return completeDevice(pending, await completeLogin(token))
  } catch (err) {
    return completeDevice(pending, {
      ok: false,
      reason: "exchange-failed",
      detail: err instanceof Error ? err.message : String(err),
    })
  } finally {
    pending.polling = false
  }
}

export async function refreshOpenAiToken(refreshToken: string): Promise<RefreshResult> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`token refresh failed (HTTP ${res.status}): ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as TokenResponse
  if (!json.access_token) {
    throw new Error("token refresh response missing access token")
  }
  const identity = extractIdentity(json.id_token, json.access_token)
  return {
    access: json.access_token,
    refresh: json.refresh_token ?? refreshToken,
    expires: Date.now() + (json.expires_in ?? 3600) * 1000,
    ...(identity ? { accountId: identity.accountId } : {}),
  }
}

export function isOpenAiTokenStale(token: { access?: string; expires?: number }): boolean {
  return !token.access || !token.expires || token.expires <= Date.now() + STALE_BUFFER_MS
}

export const openAiAccountProvider: AccountProviderDescriptor = {
  id: PROVIDER_ID,
  label: PROVIDER_LABEL,
  credentialAdapter: createAuthJsonCredentialAdapter(PROVIDER_ID),
  login: {
    kind: "oauth-callback",
    start: () => startOpenAiLogin(),
    poll: pollOpenAiLogin,
    cancel: cancelOpenAiLogin,
  },
  alternateLogins: [
    {
      kind: "oauth-device",
      start: startOpenAiDeviceLogin,
      poll: pollOpenAiDeviceLogin,
      cancel: cancelOpenAiDeviceLogin,
    },
  ],
  refresh: {
    isStale: isOpenAiTokenStale,
    refresh: refreshOpenAiToken,
  },
  refreshRuntimesOnSwitch: true,
  removableWhenActive: true,
}

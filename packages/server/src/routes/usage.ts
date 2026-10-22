import { Hono } from "hono"
import { z } from "zod"
import { DEFAULT_ACCOUNT_PROVIDER, findAccountLogin, getAccountProvider } from "../lib/account-providers"
import { switchToAccount } from "../lib/account-switcher"
import { addApiKeyAccount } from "../lib/api-key-onboard"
import { authorize, exchange, removeAccount } from "../lib/claude-onboard"
import { collectUsage, retagActiveInCache } from "../lib/claude-usage"
import { getWorkerConfig, isWorkerMode } from "../lib/config"
import { createLeaseClient } from "../lib/lease-client"
import { writeLease } from "../lib/lease-writer"
import { runtimeManager } from "../lib/process-manager"
import { parseBody } from "../lib/validation"

const SwitchAccountBody = z.object({
  accountId: z.string().min(1),
  provider: z.string().min(1).optional(),
})
const ExchangeBody = z.object({
  pendingId: z.string().min(1),
  code: z.string().min(1),
})
const AddAccountBody = z.object({
  provider: z.string().min(1),
  key: z.string().min(1),
})
const OAuthAuthorizeBody = z.object({
  provider: z.string().min(1),
  method: z.enum(["callback", "device"]).optional(),
})

function isRegisteredAccountProvider(id: string): boolean {
  try {
    getAccountProvider(id)
    return true
  } catch {
    return false
  }
}

export const usageRoutes = new Hono()

usageRoutes.get("/", async (c) => {
  const provider = c.req.query("provider") ?? DEFAULT_ACCOUNT_PROVIDER
  if (!isRegisteredAccountProvider(provider)) {
    return c.json({ error: `unknown account provider: ${provider}` }, 400)
  }
  const result = await collectUsage(provider)
  return c.json(result)
})

usageRoutes.post("/switch", async (c) => {
  const [body, err] = await parseBody(c, SwitchAccountBody)
  if (err) return err
  const provider = body.provider ?? DEFAULT_ACCOUNT_PROVIDER

  // Worker mode routes the DEFAULT provider through the cloud pool; other
  // providers are machine-local and keep the local switch path.
  if (isWorkerMode() && provider === DEFAULT_ACCOUNT_PROVIDER) {
    const cfg = getWorkerConfig()
    if (!cfg) return c.json({ error: "worker config not available" }, 500)
    const client = createLeaseClient(cfg.masterUrl, cfg.workerId)
    const outcome = await client.lease({ reason: "prelease", preferredAccountIdPrefix: body.accountId, attempts: 3 })
    if (!outcome.ok) {
      const detail = outcome.failure.kind === "refused" ? outcome.failure.refused : outcome.failure.kind
      return c.json({ error: `master refused: ${detail}` }, 400)
    }
    if (outcome.lease.expiresAt <= Date.now()) {
      return c.json({ error: "master returned stale lease" }, 502)
    }
    await writeLease({
      access: outcome.lease.access,
      expires: outcome.lease.expiresAt,
      accountId: outcome.lease.accountId,
    })
    runtimeManager.adoptHeldAccount(outcome.lease.accountId)
    const result = retagActiveInCache(provider, outcome.lease.accountId) ?? (await collectUsage(provider))
    return c.json(result)
  }

  try {
    await switchToAccount(provider, body.accountId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: msg }, 400)
  }
  const result = retagActiveInCache(provider, body.accountId) ?? (await collectUsage(provider))
  return c.json(result)
})

// ---------------------------------------------------------------------------
// Claude OAuth onboarding — add accounts via PKCE flow
// ---------------------------------------------------------------------------

usageRoutes.post("/authorize", (c) => {
  if (isWorkerMode()) {
    return c.json({ error: "account onboarding is not available in worker mode" }, 400)
  }
  const result = authorize()
  return c.json(result)
})

usageRoutes.post("/accounts", async (c) => {
  const [body, err] = await parseBody(c, AddAccountBody)
  if (err) return err
  if (!isRegisteredAccountProvider(body.provider)) {
    return c.json({ error: `unknown account provider: ${body.provider}` }, 400)
  }
  const result = await addApiKeyAccount(body.provider, body.key)
  if (!result.ok) {
    const status = result.reason === "unreachable" || result.reason === "unexpected" ? 502 : 400
    return c.json(result, status)
  }
  return c.json(result)
})

function loginKind(method: string | undefined): "oauth-callback" | "oauth-device" | undefined {
  if (method === undefined || method === "callback") return "oauth-callback"
  if (method === "device") return "oauth-device"
  return undefined
}

function loginLabel(kind: "oauth-callback" | "oauth-device"): string {
  return kind === "oauth-device" ? "device code login" : "browser oauth"
}

usageRoutes.post("/oauth/authorize", async (c) => {
  const [body, err] = await parseBody(c, OAuthAuthorizeBody)
  if (err) return err
  if (!isRegisteredAccountProvider(body.provider)) {
    return c.json({ error: `unknown account provider: ${body.provider}` }, 400)
  }
  if (isWorkerMode() && body.provider === DEFAULT_ACCOUNT_PROVIDER) {
    return c.json({ error: "account onboarding is not available in worker mode" }, 400)
  }
  const kind = loginKind(body.method)
  if (!kind) {
    return c.json({ error: `unknown login method: ${body.method}` }, 400)
  }
  const descriptor = getAccountProvider(body.provider)
  const login = findAccountLogin(descriptor, kind)
  if (!login || (login.kind !== "oauth-callback" && login.kind !== "oauth-device")) {
    return c.json({ error: `provider ${body.provider} does not support ${loginLabel(kind)}` }, 400)
  }
  try {
    const result = await login.start()
    return c.json({ mode: login.kind, ...result })
  } catch (error) {
    const status = kind === "oauth-device" ? 502 : 409
    return c.json({ error: error instanceof Error ? error.message : String(error) }, status)
  }
})

usageRoutes.get("/oauth/:provider/logins/:pendingId", async (c) => {
  const provider = c.req.param("provider")
  if (!isRegisteredAccountProvider(provider)) {
    return c.json({ error: `unknown account provider: ${provider}` }, 400)
  }
  if (isWorkerMode() && provider === DEFAULT_ACCOUNT_PROVIDER) {
    return c.json({ error: "account onboarding is not available in worker mode" }, 400)
  }
  const kind = loginKind(c.req.query("method"))
  if (!kind) {
    return c.json({ error: `unknown login method: ${c.req.query("method")}` }, 400)
  }
  const descriptor = getAccountProvider(provider)
  const login = findAccountLogin(descriptor, kind)
  if (!login || (login.kind !== "oauth-callback" && login.kind !== "oauth-device")) {
    return c.json({ error: `provider ${provider} does not support ${loginLabel(kind)}` }, 400)
  }
  const state = await login.poll(c.req.param("pendingId"))
  if (!state) {
    return c.json({ error: "unknown login session" }, 404)
  }
  return c.json(state)
})

usageRoutes.delete("/oauth/:provider/logins/:pendingId", async (c) => {
  const provider = c.req.param("provider")
  if (!isRegisteredAccountProvider(provider)) {
    return c.json({ error: `unknown account provider: ${provider}` }, 400)
  }
  if (isWorkerMode() && provider === DEFAULT_ACCOUNT_PROVIDER) {
    return c.json({ error: "account onboarding is not available in worker mode" }, 400)
  }
  const kind = loginKind(c.req.query("method"))
  if (!kind) {
    return c.json({ error: `unknown login method: ${c.req.query("method")}` }, 400)
  }
  const descriptor = getAccountProvider(provider)
  const login = findAccountLogin(descriptor, kind)
  if (!login || (login.kind !== "oauth-callback" && login.kind !== "oauth-device")) {
    return c.json({ error: `provider ${provider} does not support ${loginLabel(kind)}` }, 400)
  }
  await login.cancel(c.req.param("pendingId"))
  return c.body(null, 204)
})

usageRoutes.post("/exchange", async (c) => {
  if (isWorkerMode()) {
    return c.json({ error: "account onboarding is not available in worker mode" }, 400)
  }
  const [body, err] = await parseBody(c, ExchangeBody)
  if (err) return err
  const result = await exchange(body.pendingId, body.code.trim())
  if (!result.ok) {
    const status = result.reason === "throttled" ? 429 : 400
    return c.json(result, status)
  }
  return c.json(result)
})

usageRoutes.delete("/accounts/:id", async (c) => {
  const id = c.req.param("id")
  const result = await removeAccount(id)
  if (!result.ok) {
    return c.json({ error: result.reason }, 400)
  }
  return c.json(result)
})

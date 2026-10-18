import { Hono } from "hono"
import { z } from "zod"
import { DEFAULT_ACCOUNT_PROVIDER, getAccountProvider } from "../lib/account-providers"
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

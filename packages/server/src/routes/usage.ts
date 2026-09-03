import { Hono } from "hono"
import { collectUsage, retagActiveInCache } from "../lib/claude-usage"
import { switchToAccount } from "../lib/account-switcher"
import { isWorkerMode, getWorkerConfig } from "../lib/config"
import { createLeaseClient } from "../lib/lease-client"
import { writeLease } from "../lib/lease-writer"
import { runtimeManager } from "../lib/process-manager"
import { authorize, exchange, removeAccount } from "../lib/claude-onboard"

export const usageRoutes = new Hono()

usageRoutes.get("/", async (c) => {
  const result = await collectUsage()
  return c.json(result)
})

usageRoutes.post("/switch", async (c) => {
  const body = await c.req.json<{ accountId?: string }>()
  if (!body.accountId || typeof body.accountId !== "string") {
    return c.json({ error: "accountId is required" }, 400)
  }

  if (isWorkerMode()) {
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
    await writeLease({ access: outcome.lease.access, expires: outcome.lease.expiresAt, accountId: outcome.lease.accountId })
    runtimeManager.adoptHeldAccount(outcome.lease.accountId)
    const result = retagActiveInCache(outcome.lease.accountId) ?? await collectUsage()
    return c.json(result)
  }

  try {
    await switchToAccount(body.accountId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: msg }, 400)
  }
  const result = retagActiveInCache(body.accountId) ?? await collectUsage()
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

usageRoutes.post("/exchange", async (c) => {
  if (isWorkerMode()) {
    return c.json({ error: "account onboarding is not available in worker mode" }, 400)
  }
  const body = await c.req.json<{ pendingId?: string; code?: string }>()
  if (!body.pendingId || typeof body.pendingId !== "string") {
    return c.json({ error: "pendingId is required" }, 400)
  }
  if (!body.code || typeof body.code !== "string") {
    return c.json({ error: "code is required" }, 400)
  }
  const result = await exchange(body.pendingId, body.code.trim())
  if (!result.ok) {
    const status = result.reason === "throttled" ? 429 : 400
    return c.json(result, status)
  }
  return c.json(result)
})

usageRoutes.delete("/accounts/:id", async (c) => {
  if (isWorkerMode()) {
    return c.json({ error: "account removal is not available in worker mode" }, 400)
  }
  const id = c.req.param("id")
  const result = await removeAccount(id)
  if (!result.ok) {
    return c.json({ error: result.reason }, 400)
  }
  return c.json(result)
})

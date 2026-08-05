import { Hono } from "hono"
import { collectUsage, retagActiveInCache } from "../lib/claude-usage"
import { switchToAccount } from "../lib/account-switcher"
import { isWorkerMode, getWorkerConfig } from "../lib/config"
import { createLeaseClient } from "../lib/lease-client"
import { writeLease } from "../lib/lease-writer"
import { processManager } from "../lib/process-manager"

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
    processManager.adoptHeldAccount(outcome.lease.accountId)
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

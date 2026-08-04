import { Hono } from "hono"
import { getWorkerConfig, getDefaultWorkerId } from "../lib/config"
import { CLOUD_ROUTES, NETWORK_TIMEOUT_MS } from "../lib/lease-constants"
import { processManager } from "../lib/process-manager"
import { logger } from "../middleware/logger"

export const cloudRoutes = new Hono()

async function probeMaster(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}${CLOUD_ROUTES.health}`, { signal: AbortSignal.timeout(5_000) })
    return res.ok
  } catch {
    return false
  }
}

type SnapshotAccount = { idPrefix: string; label: string }

async function resolveHeldAccount(masterUrl: string, accountId: string): Promise<{ id: string; label: string }> {
  try {
    const res = await fetch(`${masterUrl}${CLOUD_ROUTES.usage}`, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) })
    if (!res.ok) return { id: accountId, label: accountId.slice(0, 8) }
    const data = (await res.json()) as { accounts?: SnapshotAccount[] }
    if (!Array.isArray(data.accounts)) return { id: accountId, label: accountId.slice(0, 8) }
    const match = data.accounts.find((a) => accountId.startsWith(a.idPrefix))
    if (match) return { id: accountId, label: match.label }
    logger.debug({ accountId: accountId.slice(0, 8), prefixes: data.accounts.map((a) => a.idPrefix) }, "cloud: no prefix match for held account")
    return { id: accountId, label: accountId.slice(0, 8) }
  } catch {
    return { id: accountId, label: accountId.slice(0, 8) }
  }
}

cloudRoutes.get("/status", async (c) => {
  const cfg = getWorkerConfig()
  if (!cfg) return c.json({ mode: "local", defaultWorkerId: getDefaultWorkerId() })

  const connected = await probeMaster(cfg.masterUrl)
  const heldId = processManager.getHeldAccountId()
  const heldAccount = heldId ? await resolveHeldAccount(cfg.masterUrl, heldId) : undefined

  return c.json({
    mode: "worker",
    masterUrl: cfg.masterUrl,
    workerId: cfg.workerId,
    connected,
    heldAccount,
    defaultWorkerId: getDefaultWorkerId(),
  })
})

cloudRoutes.post("/test", async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => null)
  if (!body?.url || typeof body.url !== "string") return c.json({ error: "url is required" }, 400)
  const connected = await probeMaster(body.url)
  return c.json({ connected })
})

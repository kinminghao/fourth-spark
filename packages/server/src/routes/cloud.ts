import { Hono } from "hono"
import { getWorkerConfig, getDefaultWorkerId } from "../lib/config"
import { CLOUD_ROUTES, NETWORK_TIMEOUT_MS } from "../lib/lease-constants"
import { loadAccounts } from "../lib/auth-files"
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

async function resolveHeldLabel(masterUrl: string, activeId: string): Promise<string> {
  try {
    const res = await fetch(`${masterUrl}${CLOUD_ROUTES.usage}`, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) })
    if (!res.ok) {
      logger.debug({ status: res.status }, "cloud: master usage fetch failed")
      return activeId.slice(0, 8)
    }
    const data = (await res.json()) as { accounts?: SnapshotAccount[] }
    if (!Array.isArray(data.accounts)) {
      logger.debug({ keys: Object.keys(data) }, "cloud: unexpected usage response shape")
      return activeId.slice(0, 8)
    }
    const match = data.accounts.find((a) =>
      activeId.startsWith(a.idPrefix) || a.idPrefix.startsWith(activeId.slice(0, 8)),
    )
    if (match) return match.label
    logger.debug({ activeId: activeId.slice(0, 8), prefixes: data.accounts.map((a) => a.idPrefix) }, "cloud: no prefix match")
    return activeId.slice(0, 8)
  } catch (err) {
    logger.debug({ error: err instanceof Error ? err.message : String(err) }, "cloud: master usage fetch error")
    return activeId.slice(0, 8)
  }
}

cloudRoutes.get("/status", async (c) => {
  const cfg = getWorkerConfig()
  if (!cfg) return c.json({ mode: "local", defaultWorkerId: getDefaultWorkerId() })

  const [connected, file] = await Promise.all([probeMaster(cfg.masterUrl), loadAccounts()])
  const heldAccount = file.activeId
    ? { id: file.activeId, label: await resolveHeldLabel(cfg.masterUrl, file.activeId) }
    : undefined

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

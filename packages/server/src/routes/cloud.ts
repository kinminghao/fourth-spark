import { Hono } from "hono"
import { isWorkerMode, getWorkerConfig } from "../lib/config"
import { CLOUD_ROUTES } from "../lib/lease-constants"

export const cloudRoutes = new Hono()

cloudRoutes.get("/status", async (c) => {
  const cfg = getWorkerConfig()
  if (!cfg) return c.json({ mode: "local" })

  let connected = false
  try {
    const res = await fetch(`${cfg.masterUrl}${CLOUD_ROUTES.health}`, { signal: AbortSignal.timeout(5_000) })
    connected = res.ok
  } catch { /* unreachable */ }

  return c.json({ mode: "worker", masterUrl: cfg.masterUrl, workerId: cfg.workerId, connected })
})

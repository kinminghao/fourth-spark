import { Hono } from "hono"
import { getWorkerConfig } from "../lib/config"
import { CLOUD_ROUTES } from "../lib/lease-constants"

export const cloudRoutes = new Hono()

async function probeMaster(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}${CLOUD_ROUTES.health}`, { signal: AbortSignal.timeout(5_000) })
    return res.ok
  } catch {
    return false
  }
}

cloudRoutes.get("/status", async (c) => {
  const cfg = getWorkerConfig()
  if (!cfg) return c.json({ mode: "local" })
  const connected = await probeMaster(cfg.masterUrl)
  return c.json({ mode: "worker", masterUrl: cfg.masterUrl, workerId: cfg.workerId, connected })
})

cloudRoutes.post("/test", async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => null)
  if (!body?.url || typeof body.url !== "string") return c.json({ error: "url is required" }, 400)
  const connected = await probeMaster(body.url)
  return c.json({ connected })
})

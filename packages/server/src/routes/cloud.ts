import { Hono } from "hono"
import { getWorkerConfig } from "../lib/config"
import { CLOUD_ROUTES, NETWORK_TIMEOUT_MS } from "../lib/lease-constants"
import { loadAccounts } from "../lib/auth-files"
import type { UsageAccountView } from "../lib/usage-client"

export const cloudRoutes = new Hono()

async function probeMaster(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}${CLOUD_ROUTES.health}`, { signal: AbortSignal.timeout(5_000) })
    return res.ok
  } catch {
    return false
  }
}

async function fetchHeldAccount(masterUrl: string, activeId: string | undefined): Promise<{ id: string; label: string } | undefined> {
  if (!activeId) return undefined
  try {
    const res = await fetch(`${masterUrl}${CLOUD_ROUTES.usage}`, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) })
    if (!res.ok) return { id: activeId, label: activeId.slice(0, 8) }
    const data = (await res.json()) as { accounts?: UsageAccountView[] }
    const match = data.accounts?.find((a) => activeId.startsWith(a.idPrefix))
    return match ? { id: activeId, label: match.label } : { id: activeId, label: activeId.slice(0, 8) }
  } catch {
    return { id: activeId, label: activeId.slice(0, 8) }
  }
}

cloudRoutes.get("/status", async (c) => {
  const cfg = getWorkerConfig()
  if (!cfg) return c.json({ mode: "local" })

  const [connected, file] = await Promise.all([probeMaster(cfg.masterUrl), loadAccounts()])
  const held = await fetchHeldAccount(cfg.masterUrl, file.activeId)

  return c.json({
    mode: "worker",
    masterUrl: cfg.masterUrl,
    workerId: cfg.workerId,
    connected,
    heldAccount: held,
  })
})

cloudRoutes.post("/test", async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => null)
  if (!body?.url || typeof body.url !== "string") return c.json({ error: "url is required" }, 400)
  const connected = await probeMaster(body.url)
  return c.json({ connected })
})

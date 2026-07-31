import { Hono } from "hono"
import { processManager } from "../lib/process-manager"
import { APP_VERSION } from "../lib/config"

export const health = new Hono()

health.get("/", async (c) => {
  return c.json({ status: "ok", version: APP_VERSION })
})

// GET /api/repos/:repoId/health — reports whether the repo's opencode is reachable.
export const repoHealth = new Hono()

const PROBE_TIMEOUT_MS = 1500

repoHealth.get("/", async (c) => {
  const repoId = c.req.param("repoId")
  const client = processManager.getClient(repoId)
  if (!client) {
    return c.json({ status: "not_running", repoId })
  }

  let reachable = false
  try {
    const res = await fetch(new URL("/agent", client.baseUrl), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    reachable = res.ok
  } catch {
    reachable = false
  }

  return c.json({
    status: "ok",
    repoId,
    opencode: { url: client.baseUrl, reachable },
    workspace: client.directory,
  })
})

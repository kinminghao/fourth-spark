import { Hono } from "hono"
import { OPENCODE_URL, WORKSPACE_DIR } from "../lib/config"

export const health = new Hono()

const PROBE_TIMEOUT_MS = 1500

// GET /api/health — reports backend liveness and whether OpenCode is reachable.
// Never throws: an unreachable OpenCode still returns 200 with reachable=false.
health.get("/", async (c) => {
  let reachable = false
  try {
    const res = await fetch(new URL("/agent", OPENCODE_URL), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    reachable = res.ok
  } catch {
    reachable = false
  }

  return c.json({
    status: "ok",
    opencode: { url: OPENCODE_URL, reachable },
    workspace: WORKSPACE_DIR,
  })
})

import { Hono } from "hono"
import { processManager } from "../lib/process-manager"
import { APP_VERSION } from "../lib/config"

const REPO = "kinminghao/fourth-spark"
const CACHE_TTL = 3600_000

let cachedLatest: { version: string; fetchedAt: number } | null = null

async function getLatestVersion(): Promise<string | null> {
  if (cachedLatest && Date.now() - cachedLatest.fetchedAt < CACHE_TTL) {
    return cachedLatest.version
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { "User-Agent": "fourth-spark" },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return cachedLatest?.version ?? null
    const data = (await res.json()) as { tag_name: string }
    const version = data.tag_name.replace(/^v/, "")
    cachedLatest = { version, fetchedAt: Date.now() }
    return version
  } catch {
    return cachedLatest?.version ?? null
  }
}

export const health = new Hono()

health.get("/", async (c) => {
  const latestVersion = await getLatestVersion()
  return c.json({ status: "ok", version: APP_VERSION, latestVersion })
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

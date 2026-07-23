import { type Subprocess } from "bun"
import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { repos } from "../db/schema"
import { syncSessionsList, syncMessagesList } from "../db/sync"
import { createOpenCodeClient, type OpenCodeClient } from "./opencode"
import { logger } from "../middleware/logger"

// ---------------------------------------------------------------------------
// Port allocation
// ---------------------------------------------------------------------------

const PORT_BASE = 8081
const PORT_MAX = 8199

async function isPortFree(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}`, {
      signal: AbortSignal.timeout(300),
    })
    // Something is already listening — not free.
    return false
  } catch {
    return true
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManagedRepo {
  id: string
  localPath: string
  port: number
  process: Subprocess
  client: OpenCodeClient
}

// ---------------------------------------------------------------------------
// ProcessManager — one opencode process per repo
// ---------------------------------------------------------------------------

const managed = new Map<string, ManagedRepo>()

/** Ports currently claimed by this manager (to avoid double-assign). */
function usedPorts(): Set<number> {
  const set = new Set<number>()
  for (const entry of managed.values()) set.add(entry.port)
  return set
}

async function allocatePort(): Promise<number> {
  const used = usedPorts()
  for (let port = PORT_BASE; port <= PORT_MAX; port++) {
    if (used.has(port)) continue
    if (await isPortFree(port)) return port
  }
  throw new Error(`No free port in range ${PORT_BASE}–${PORT_MAX}`)
}

async function waitForReady(port: number, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/agent`, {
        signal: AbortSignal.timeout(1000),
      })
      if (res.ok) return true
    } catch {
      // Not ready yet.
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function spawnOpenCode(repoId: string, localPath: string, port: number): Promise<ManagedRepo> {
  logger.info({ repoId, localPath, port }, "spawning opencode serve")

  const proc = Bun.spawn(["opencode", "serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: localPath,
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env, PORT: String(port) },
  })

  const baseUrl = `http://127.0.0.1:${port}`
  const client = createOpenCodeClient(baseUrl, localPath)

  const ready = await waitForReady(port)
  if (!ready) {
    proc.kill()
    throw new Error(`opencode serve did not become ready on port ${port} for repo ${repoId}`)
  }

  logger.info({ repoId, port }, "opencode serve ready")

  await db.update(repos).set({ port, status: "active", updatedAt: Date.now() }).where(eq(repos.id, repoId))

  const entry: ManagedRepo = { id: repoId, localPath, port, process: proc, client }
  managed.set(repoId, entry)

  initialSync(client, repoId).catch((err) => {
    logger.error({ err, repoId }, "initial session sync failed")
  })

  return entry
}

async function initialSync(client: OpenCodeClient, repoId: string): Promise<void> {
  logger.info({ repoId }, "starting initial session sync")
  const sessionList = await client.listSessions()
  syncSessionsList(sessionList)
  for (const session of sessionList) {
    try {
      const msgs = await client.getMessages(session.id)
      syncMessagesList(session.id, msgs)
    } catch (err) {
      logger.warn({ err, repoId, sessionId: session.id }, "skipping message sync for session")
    }
  }
  logger.info({ repoId, count: sessionList.length }, "initial session sync complete")
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const processManager = {
  /** Start opencode for a single repo. Idempotent — skips if already running. */
  async start(repoId: string, localPath: string): Promise<OpenCodeClient> {
    const existing = managed.get(repoId)
    if (existing) return existing.client

    const port = await allocatePort()
    const entry = await spawnOpenCode(repoId, localPath, port)
    return entry.client
  },

  /** Stop opencode for a single repo. */
  async stop(repoId: string): Promise<void> {
    const entry = managed.get(repoId)
    if (!entry) return
    logger.info({ repoId, port: entry.port }, "stopping opencode serve")
    entry.process.kill()
    managed.delete(repoId)
    await db.update(repos).set({ port: null, status: "inactive", updatedAt: Date.now() }).where(eq(repos.id, repoId))
  },

  /** Get the OpenCodeClient for a running repo. Returns null if not running. */
  getClient(repoId: string | undefined): OpenCodeClient | null {
    if (!repoId) return null
    return managed.get(repoId)?.client ?? null
  },

  /** Require client or throw 404-shaped error. */
  requireClient(repoId: string | undefined): OpenCodeClient {
    if (!repoId) throw new Error("Missing repoId")
    const client = managed.get(repoId)?.client
    if (!client) throw new Error(`Repo ${repoId} is not running`)
    return client
  },

  /** Is the repo's opencode process running? */
  isRunning(repoId: string): boolean {
    return managed.has(repoId)
  },

  /** Start all repos from the database. Called once on server boot. */
  async startAll(): Promise<void> {
    const allRepos = await db.select().from(repos)
    logger.info({ count: allRepos.length }, "starting opencode for all repos")
    for (const repo of allRepos) {
      try {
        await this.start(repo.id, repo.localPath)
      } catch (err) {
        logger.error({ err, repoId: repo.id, localPath: repo.localPath }, "failed to start opencode for repo")
        await db.update(repos).set({ status: "error", updatedAt: Date.now() }).where(eq(repos.id, repo.id))
      }
    }
  },

  /** Stop all managed processes. Called on server shutdown. */
  async stopAll(): Promise<void> {
    const ids = [...managed.keys()]
    for (const id of ids) {
      await this.stop(id)
    }
  },
}

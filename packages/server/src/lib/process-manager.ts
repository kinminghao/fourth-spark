import { type Subprocess } from "bun"
import { eq } from "drizzle-orm"
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { db } from "../db/index"
import { repos } from "../db/schema"
import { syncSessionsList, syncMessagesList } from "../db/sync"
import { createOpenCodeClient, type OpenCodeClient } from "./opencode"
import { sessionMonitor } from "./session-monitor"
import { logger } from "../middleware/logger"

// ---------------------------------------------------------------------------
// Port allocation
// ---------------------------------------------------------------------------

const PORT_BASE = 8081
const PORT_MAX = 8199

async function isPortFree(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}`, {
      signal: AbortSignal.timeout(300),
    })
    // Something is already listening — not free.
    return false
  } catch {
    return true
  }
}

// ---------------------------------------------------------------------------
// PID file — persists {pid, port, repoId} across restarts so we can kill
// orphans left behind when bun --watch restarts without graceful shutdown.
// ---------------------------------------------------------------------------

const PID_DIR = join("/tmp", "fourth-spark")
const PID_FILE = join(PID_DIR, "pid-map.json")

interface PidRecord {
  pid: number
  port: number
  repoId: string
}

function readPidFile(): PidRecord[] {
  try {
    if (!existsSync(PID_FILE)) return []
    const raw = readFileSync(PID_FILE, "utf-8")
    return JSON.parse(raw) as PidRecord[]
  } catch {
    return []
  }
}

function writePidFile(): void {
  try {
    mkdirSync(PID_DIR, { recursive: true })
    const records: PidRecord[] = []
    for (const entry of managed.values()) {
      records.push({ pid: entry.process.pid, port: entry.port, repoId: entry.id })
    }
    writeFileSync(PID_FILE, JSON.stringify(records, null, 2))
  } catch (err) {
    logger.warn({ err }, "failed to write PID file")
  }
}

function clearPidFile(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Orphan cleanup — runs on startup before spawning new processes
// ---------------------------------------------------------------------------

function killPid(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM")
    return true
  } catch {
    return false // already dead
  }
}

async function cleanupOrphans(): Promise<void> {
  let needsWait = false

  // Phase 1: Kill PIDs from our PID file (targeted, reliable)
  const oldRecords = readPidFile()
  if (oldRecords.length > 0) {
    logger.info({ count: oldRecords.length }, "cleaning up tracked orphan processes from PID file")
    for (const record of oldRecords) {
      if (killPid(record.pid)) {
        logger.info({ pid: record.pid, port: record.port, repoId: record.repoId }, "killed tracked orphan")
        needsWait = true
      }
    }
    clearPidFile()
  }

  // Phase 2: Scan OS for any stray `opencode serve` processes in our port range.
  // Catches orphans from runs before PID tracking was added.
  try {
    const result = Bun.spawnSync(["pgrep", "-f", "opencode serve --port"])
    const output = result.stdout.toString().trim()
    if (output) {
      const myPid = process.pid
      const strayPids = output.split("\n").map(Number).filter((p) => p && p !== myPid)
      let killed = 0
      for (const pid of strayPids) {
        if (killPid(pid)) killed++
      }
      if (killed > 0) {
        logger.info({ killed }, "killed stray opencode serve processes")
        needsWait = true
      }
    }
  } catch {
    // pgrep not available — non-fatal
  }

  // Give killed processes time to release ports
  if (needsWait) {
    await new Promise((r) => setTimeout(r, 1500))
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

/** In-flight start() promises — prevents concurrent spawn for the same repoId. */
const startingLocks = new Map<string, Promise<OpenCodeClient>>()

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
  writePidFile()

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
  /** Kill orphan opencode processes from previous server runs. Call before startAll(). */
  cleanupOrphans,

  /** Start opencode for a single repo. Idempotent + concurrent-safe. */
  async start(repoId: string, localPath: string): Promise<OpenCodeClient> {
    // Fast path: already running
    const existing = managed.get(repoId)
    if (existing) return existing.client

    // Concurrent-safe: if another call is already starting this repo, coalesce
    const inflight = startingLocks.get(repoId)
    if (inflight) return inflight

    const promise = (async () => {
      try {
        const port = await allocatePort()
        const entry = await spawnOpenCode(repoId, localPath, port)
        sessionMonitor.register(repoId, entry.client)
        return entry.client
      } finally {
        startingLocks.delete(repoId)
      }
    })()

    startingLocks.set(repoId, promise)
    return promise
  },

  /** Stop opencode for a single repo. */
  async stop(repoId: string): Promise<void> {
    const entry = managed.get(repoId)
    if (!entry) return
    sessionMonitor.unregister(repoId)
    logger.info({ repoId, port: entry.port }, "stopping opencode serve")
    entry.process.kill()
    managed.delete(repoId)
    writePidFile()
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
    sessionMonitor.start()
  },

  /** Stop all managed processes. Called on server shutdown. */
  async stopAll(): Promise<void> {
    sessionMonitor.stop()
    const ids = [...managed.keys()]
    for (const id of ids) {
      await this.stop(id)
    }
  },

  /**
   * Synchronous kill of all managed processes.
   * Last-resort for `exit` handler where async is not available.
   */
  killAllSync(): void {
    for (const entry of managed.values()) {
      try {
        process.kill(entry.process.pid, "SIGKILL")
      } catch {
        // already dead
      }
    }
    managed.clear()
    clearPidFile()
  },
}

import { type Subprocess } from "bun"
import { eq } from "drizzle-orm"
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, openSync } from "node:fs"
import { join } from "node:path"
import { db } from "../db/index"
import { repos } from "../db/schema"
import { syncSessionsList, syncMessagesList } from "../db/sync"
import { createOpenCodeClient, type OpenCodeClient } from "./opencode"
import { sessionMonitor } from "./session-monitor"
import { logger } from "../middleware/logger"
import { PORT } from "./config"

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

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function verifyOpenCodeIdentity(port: number, expectedDir: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/session?directory=${encodeURIComponent(expectedDir)}`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function adoptOrphans(): Promise<Map<string, PidRecord>> {
  const adopted = new Map<string, PidRecord>()
  const oldRecords = readPidFile()
  if (oldRecords.length === 0) return adopted

  const allRepos = await db.select().from(repos)
  const repoPathMap = new Map(allRepos.map((r) => [r.id, r.localPath]))

  for (const record of oldRecords) {
    const alive = await isProcessAlive(record.pid)
    if (!alive) {
      logger.info({ pid: record.pid, repoId: record.repoId }, "orphan process already dead, skipping")
      continue
    }

    const expectedDir = repoPathMap.get(record.repoId)
    if (!expectedDir) {
      killPid(record.pid)
      logger.info({ pid: record.pid, repoId: record.repoId }, "orphan repo no longer in DB, killed")
      continue
    }

    const verified = await verifyOpenCodeIdentity(record.port, expectedDir)
    if (verified) {
      adopted.set(record.repoId, record)
      logger.info({ pid: record.pid, port: record.port, repoId: record.repoId }, "adopted live orphan process")
    } else {
      killPid(record.pid)
      logger.info({ pid: record.pid, repoId: record.repoId }, "orphan identity verification failed, killed")
    }
  }

  const adoptedPids = new Set([...adopted.values()].map((r) => r.pid))
  try {
    const result = Bun.spawnSync(["pgrep", "-f", "opencode serve --port"])
    const output = result.stdout.toString().trim()
    if (output) {
      const myPid = process.pid
      const strayPids = output.split("\n").map(Number).filter((p) => p && p !== myPid && !adoptedPids.has(p))
      let killed = 0
      for (const pid of strayPids) {
        if (killPid(pid)) killed++
      }
      if (killed > 0) {
        logger.info({ killed }, "killed stray opencode serve processes not in PID file")
      }
    }
  } catch {
  }

  if (adopted.size > 0) {
    logger.info({ count: adopted.size }, "adopted live opencode processes from previous run")
  }

  return adopted
}

async function cleanupOrphans(): Promise<void> {
  let needsWait = false

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

  if (needsWait) {
    await new Promise((r) => setTimeout(r, 1500))
  }
}

// ---------------------------------------------------------------------------
// OpenCode MCP config injection — writes our MCP server entry into the repo's
// opencode.json so the agent can call Git platform tools automatically.
// ---------------------------------------------------------------------------

const MCP_SERVER_KEY = "fourth-spark-git"

function injectMcpConfig(localPath: string, repoId: string): void {
  const configPath = join(localPath, "opencode.json")
  let config: Record<string, unknown> = {}
  try {
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    }
  } catch {
    // corrupt or missing — start fresh
  }

  const mcp = (config.mcp ?? {}) as Record<string, unknown>
  mcp[MCP_SERVER_KEY] = {
    type: "remote",
    url: `http://127.0.0.1:${PORT}/api/repos/${repoId}/mcp`,
  }
  config.mcp = mcp
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
  logger.info({ repoId, configPath }, "injected MCP config into opencode.json")
}

function removeMcpConfig(localPath: string): void {
  const configPath = join(localPath, "opencode.json")
  try {
    if (!existsSync(configPath)) return
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    const mcp = config.mcp as Record<string, unknown> | undefined
    if (!mcp?.[MCP_SERVER_KEY]) return

    delete mcp[MCP_SERVER_KEY]
    if (Object.keys(mcp).length === 0) delete config.mcp

    // If config is effectively empty (only $schema or nothing), remove the file
    const meaningful = Object.keys(config).filter((k) => k !== "$schema")
    if (meaningful.length === 0) {
      unlinkSync(configPath)
    } else {
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
    }
  } catch {
    // best-effort cleanup
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

  injectMcpConfig(localPath, repoId)

  const logFile = join(PID_DIR, `opencode-${repoId.slice(0, 8)}.log`)
  const logFd = openSync(logFile, "a")
  logger.info({ repoId, logFile }, "opencode debug log enabled")

  const proc = Bun.spawn([
    "opencode", "serve",
    "--port", String(port),
    "--hostname", "127.0.0.1",
    "--print-logs",
    "--log-level", "DEBUG",
  ], {
    cwd: localPath,
    stdout: logFd,
    stderr: logFd,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
    },
  })
  proc.unref()

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
  async start(repoId: string, localPath: string, adopted?: Map<string, PidRecord>): Promise<OpenCodeClient> {
    const existing = managed.get(repoId)
    if (existing) return existing.client

    const inflight = startingLocks.get(repoId)
    if (inflight) return inflight

    const promise = (async () => {
      try {
        const record = adopted?.get(repoId)
        if (record) {
          const baseUrl = `http://127.0.0.1:${record.port}`
          const client = createOpenCodeClient(baseUrl, localPath)
          const fakeProc = { pid: record.pid, kill: () => killPid(record.pid) } as unknown as Subprocess
          const entry: ManagedRepo = { id: repoId, localPath, port: record.port, process: fakeProc, client }
          managed.set(repoId, entry)
          writePidFile()
          logger.info({ repoId, port: record.port, pid: record.pid }, "reusing adopted opencode process")
          sessionMonitor.register(repoId, client)
          return client
        }

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
    removeMcpConfig(entry.localPath)
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
    const adopted = await adoptOrphans()
    const allRepos = await db.select().from(repos)
    logger.info({ count: allRepos.length, adopted: adopted.size }, "starting opencode for all repos")
    for (const repo of allRepos) {
      try {
        await this.start(repo.id, repo.localPath, adopted)
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

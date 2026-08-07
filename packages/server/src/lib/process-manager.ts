import { type Subprocess } from "bun"
import { eq } from "drizzle-orm"
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, openSync } from "node:fs"
import { join } from "node:path"
import { db } from "../db/index"
import { repos, settings, workspaces } from "../db/schema"
import { syncSessionsList, syncMessagesList } from "../db/sync"
import { createOpenCodeClient, type OpenCodeClient } from "./opencode"
import { sessionMonitor } from "./session-monitor"
import { logger } from "../middleware/logger"
import { PORT, isWorkerMode, getWorkerConfig, reloadWorkerConfig } from "./config"
import { createLeaseClient, type LeaseClient, type LeaseFailure } from "./lease-client"
import { createLeaseKeeper, type LeaseKeeper } from "./lease-keeper"
import { writeLease } from "./lease-writer"
import { parseResetMsFromMessage } from "./account-switcher"
import { getRegistry } from "../core/registry"
import { localAccountPool } from "./local-account-pool"
import type { AccountPool, AcquireResult } from "../core/types"

const LEASE_FAILURE_MESSAGES: Record<LeaseFailure["kind"], string> = {
  "no-account": "云端账号池暂无可用账号",
  unreachable: "连不上云端账号池，无法切号",
  "bad-response": "云端账号池返回了无法识别的响应",
  refused: "云端账号池拒绝了本次租借请求",
}

function createLeaseAccountPool(leaseClient: LeaseClient, keeper: LeaseKeeper): AccountPool {
  return {
    async acquire(ctx): Promise<AcquireResult> {
      const outcome = await leaseClient.lease({
        reason: "ratelimit",
        ...(ctx.currentAccountId ? { currentAccountId: ctx.currentAccountId } : {}),
      })
      if (!outcome.ok) {
        return { ok: false, reason: LEASE_FAILURE_MESSAGES[outcome.failure.kind] }
      }
      const { lease } = outcome
      if (lease.expiresAt <= Date.now()) {
        return { ok: false, reason: "stale lease" }
      }
      await writeLease({ access: lease.access, expires: lease.expiresAt, accountId: lease.accountId })
      keeper.adoptAccount(lease.accountId)
      return {
        ok: true,
        accountId: lease.accountId,
        credential: { access: lease.access },
        expiresAt: lease.expiresAt,
      }
    },
    async reportLimit(ctx): Promise<void> {
      const resetsAt = parseResetMsFromMessage(ctx.message)
      await leaseClient.reportRateLimit({
        accountId: ctx.accountId,
        headers: {},
        ...(resetsAt !== undefined ? { resetsAt } : {}),
      })
    },
    async getActiveId(): Promise<string | undefined> {
      return keeper.heldAccountId()
    },
  }
}

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
  workspaceId?: string
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
    for (const entry of workspaceManaged.values()) {
      records.push({ pid: entry.process.pid, port: entry.port, repoId: entry.repoId ?? "", workspaceId: entry.id })
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

interface AdoptionResult {
  repos: Map<string, PidRecord>
  workspaces: Map<string, PidRecord>
}

async function adoptOrphans(): Promise<AdoptionResult> {
  const adopted: AdoptionResult = { repos: new Map(), workspaces: new Map() }
  const oldRecords = readPidFile()
  if (oldRecords.length === 0) return adopted

  const allRepos = await db.select().from(repos)
  const repoPathMap = new Map(allRepos.map((r) => [r.id, r.localPath]))
  const allWorkspaces = await db.select().from(workspaces)
  const workspacePathMap = new Map(allWorkspaces.map((w) => [w.id, w.localPath]))

  for (const record of oldRecords) {
    const alive = await isProcessAlive(record.pid)
    if (!alive) {
      logger.info({ pid: record.pid, repoId: record.repoId, workspaceId: record.workspaceId }, "orphan process already dead, skipping")
      continue
    }

    const expectedDir = record.workspaceId
      ? workspacePathMap.get(record.workspaceId)
      : repoPathMap.get(record.repoId)
    if (!expectedDir) {
      killPid(record.pid)
      logger.info({ pid: record.pid, repoId: record.repoId, workspaceId: record.workspaceId }, "orphan no longer in DB, killed")
      continue
    }

    const verified = await verifyOpenCodeIdentity(record.port, expectedDir)
    if (verified) {
      if (record.workspaceId) {
        adopted.workspaces.set(record.workspaceId, record)
      } else {
        adopted.repos.set(record.repoId, record)
      }
      logger.info({ pid: record.pid, port: record.port, repoId: record.repoId, workspaceId: record.workspaceId }, "adopted live orphan process")
    } else {
      killPid(record.pid)
      logger.info({ pid: record.pid, repoId: record.repoId, workspaceId: record.workspaceId }, "orphan identity verification failed, killed")
    }
  }

  const adoptedPids = new Set<number>()
  for (const r of adopted.repos.values()) adoptedPids.add(r.pid)
  for (const r of adopted.workspaces.values()) adoptedPids.add(r.pid)
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

  const totalAdopted = adopted.repos.size + adopted.workspaces.size
  if (totalAdopted > 0) {
    logger.info({ repos: adopted.repos.size, workspaces: adopted.workspaces.size }, "adopted live opencode processes from previous run")
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
  repoId?: string
}

// ---------------------------------------------------------------------------
// ProcessManager — one opencode process per repo, plus per-workspace processes
// ---------------------------------------------------------------------------

const managed = new Map<string, ManagedRepo>()
const workspaceManaged = new Map<string, ManagedRepo>()
let activeLeaseKeeper: LeaseKeeper | undefined

const startingLocks = new Map<string, Promise<OpenCodeClient>>()
const workspaceStartingLocks = new Map<string, Promise<OpenCodeClient>>()

function usedPorts(): Set<number> {
  const set = new Set<number>()
  for (const entry of managed.values()) set.add(entry.port)
  for (const entry of workspaceManaged.values()) set.add(entry.port)
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

  mkdirSync(PID_DIR, { recursive: true })
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

async function spawnOpenCodeForWorkspace(
  workspaceId: string,
  localPath: string,
  repoId: string,
  port: number,
): Promise<ManagedRepo> {
  logger.info({ workspaceId, repoId, localPath, port }, "spawning opencode serve (workspace)")

  injectMcpConfig(localPath, repoId)

  mkdirSync(PID_DIR, { recursive: true })
  const logFile = join(PID_DIR, `opencode-ws-${workspaceId.slice(0, 8)}.log`)
  const logFd = openSync(logFile, "a")
  logger.info({ workspaceId, logFile }, "opencode workspace debug log enabled")

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
    throw new Error(`opencode serve did not become ready on port ${port} for workspace ${workspaceId}`)
  }

  logger.info({ workspaceId, port }, "opencode serve ready (workspace)")

  await db.update(workspaces)
    .set({ port, status: "active", updatedAt: Date.now() })
    .where(eq(workspaces.id, workspaceId))

  const entry: ManagedRepo = { id: workspaceId, localPath, port, process: proc, client, repoId }
  workspaceManaged.set(workspaceId, entry)
  writePidFile()

  initialSync(client, repoId).catch((err) => {
    logger.error({ err, workspaceId, repoId }, "initial session sync failed (workspace)")
  })

  return entry
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

  async startWorkspace(workspaceId: string, localPath: string, repoId: string): Promise<OpenCodeClient> {
    const existing = workspaceManaged.get(workspaceId)
    if (existing) return existing.client

    const inflight = workspaceStartingLocks.get(workspaceId)
    if (inflight) return inflight

    const promise = (async () => {
      try {
        const port = await allocatePort()
        const entry = await spawnOpenCodeForWorkspace(workspaceId, localPath, repoId, port)
        sessionMonitor.register(`ws:${workspaceId}`, entry.client)
        return entry.client
      } finally {
        workspaceStartingLocks.delete(workspaceId)
      }
    })()

    workspaceStartingLocks.set(workspaceId, promise)
    return promise
  },

  async stopWorkspace(workspaceId: string): Promise<void> {
    const entry = workspaceManaged.get(workspaceId)
    if (!entry) return
    sessionMonitor.unregister(`ws:${workspaceId}`)
    logger.info({ workspaceId, port: entry.port }, "stopping opencode serve (workspace)")
    entry.process.kill()
    workspaceManaged.delete(workspaceId)
    writePidFile()
    removeMcpConfig(entry.localPath)
    await db.update(workspaces)
      .set({ port: null, status: "inactive", updatedAt: Date.now() })
      .where(eq(workspaces.id, workspaceId))
  },

  getWorkspaceClient(workspaceId: string | undefined): OpenCodeClient | null {
    if (!workspaceId) return null
    return workspaceManaged.get(workspaceId)?.client ?? null
  },

  requireWorkspaceClient(workspaceId: string | undefined): OpenCodeClient {
    if (!workspaceId) throw new Error("Missing workspaceId")
    const client = workspaceManaged.get(workspaceId)?.client
    if (!client) throw new Error(`Workspace ${workspaceId} is not running`)
    return client
  },

  isWorkspaceRunning(workspaceId: string): boolean {
    return workspaceManaged.has(workspaceId)
  },

  async startAll(): Promise<void> {
    if (isWorkerMode()) {
      const cfg = getWorkerConfig()!
      logger.info({ masterUrl: cfg.masterUrl, workerId: cfg.workerId }, "cloud worker mode: initializing")
      const client = createLeaseClient(cfg.masterUrl, cfg.workerId)
      const healthy = await client.healthCheck()
      if (healthy) logger.info("cloud worker: master health check passed")
      else logger.warn("cloud worker: master health check failed, lease-keeper will retry")

      const keeper = createLeaseKeeper(client)
      activeLeaseKeeper = keeper
      await keeper.startup().catch((err) => logger.warn({ err }, "cloud worker: startup lease failed"))

      getRegistry().accountPool = createLeaseAccountPool(client, keeper)
    }

    const adopted = await adoptOrphans()
    const allRepos = await db.select().from(repos)
    logger.info({ count: allRepos.length, adopted: adopted.repos.size }, "starting opencode for all repos")
    for (const repo of allRepos) {
      try {
        await this.start(repo.id, repo.localPath, adopted.repos)
      } catch (err) {
        logger.error({ err, repoId: repo.id, localPath: repo.localPath }, "failed to start opencode for repo")
        await db.update(repos).set({ status: "error", updatedAt: Date.now() }).where(eq(repos.id, repo.id))
      }
    }

    const allWorkspaces = await db.select().from(workspaces)
    logger.info({ count: allWorkspaces.length, adopted: adopted.workspaces.size }, "adopting workspaces from previous run")
    for (const ws of allWorkspaces) {
      const record = adopted.workspaces.get(ws.id)
      if (!record) continue
      const baseUrl = `http://127.0.0.1:${record.port}`
      const client = createOpenCodeClient(baseUrl, ws.localPath)
      const fakeProc = { pid: record.pid, kill: () => killPid(record.pid) } as unknown as Subprocess
      const entry: ManagedRepo = { id: ws.id, localPath: ws.localPath, port: record.port, process: fakeProc, client, repoId: ws.repoId }
      workspaceManaged.set(ws.id, entry)
      writePidFile()
      sessionMonitor.register(`ws:${ws.id}`, client)
      logger.info({ workspaceId: ws.id, port: record.port, pid: record.pid }, "reusing adopted workspace opencode process")
    }

    sessionMonitor.start()
  },

  async stopAll(): Promise<void> {
    sessionMonitor.stop()
    if (activeLeaseKeeper) {
      activeLeaseKeeper.dispose()
      activeLeaseKeeper = undefined
    }
    const workspaceIds = [...workspaceManaged.keys()]
    for (const id of workspaceIds) {
      await this.stopWorkspace(id)
    }
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
    for (const entry of workspaceManaged.values()) {
      try {
        process.kill(entry.process.pid, "SIGKILL")
      } catch {
        // already dead
      }
    }
    workspaceManaged.clear()
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

  getHeldAccountId(): string | undefined {
    return activeLeaseKeeper?.heldAccountId()
  },

  adoptHeldAccount(accountId: string): void {
    activeLeaseKeeper?.adoptAccount(accountId)
  },

  async reloadCloudPool(): Promise<void> {
    if (activeLeaseKeeper) {
      activeLeaseKeeper.dispose()
      activeLeaseKeeper = undefined
      logger.info("cloud pool: disposed previous lease-keeper")
    }
    getRegistry().accountPool = localAccountPool

    const getSetting = async (key: string) => {
      const rows = await db.select().from(settings).where(eq(settings.key, key))
      return rows[0]?.value
    }
    await reloadWorkerConfig(getSetting)

    if (!isWorkerMode()) {
      logger.info("cloud pool: switched to local mode")
      return
    }

    const cfg = getWorkerConfig()!
    logger.info({ masterUrl: cfg.masterUrl, workerId: cfg.workerId }, "cloud pool: reconnecting")
    const client = createLeaseClient(cfg.masterUrl, cfg.workerId)
    const healthy = await client.healthCheck()
    if (healthy) logger.info("cloud pool: master health check passed")
    else logger.warn("cloud pool: master health check failed, lease-keeper will retry")

    const keeper = createLeaseKeeper(client)
    activeLeaseKeeper = keeper
    await keeper.startup().catch((err) => logger.warn({ err }, "cloud pool: startup lease failed"))

    getRegistry().accountPool = createLeaseAccountPool(client, keeper)
    logger.info("cloud pool: reload complete")
  },
}

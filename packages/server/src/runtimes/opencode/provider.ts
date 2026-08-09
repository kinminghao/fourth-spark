// ---------------------------------------------------------------------------
// OpenCodeProvider — RuntimeProvider implementation that spawns and manages
// one `opencode serve` process per repo. Extracted from lib/process-manager.ts.
//
// Owns:
//   * per-provider PID file (survives bun --watch restarts, orphans cleaned)
//   * port allocation inside [PORT_BASE, PORT_MAX]
//   * MCP config injection into the repo's opencode.json
//   * initial session/message sync into Postgres
//
// Does NOT own (delegated elsewhere):
//   * session monitoring / notifications (RuntimeManager will wire these up)
//   * cloud lease keeper lifecycle (RuntimeManager owns the pool switch)
// ---------------------------------------------------------------------------

import { type Subprocess } from "bun"
import { eq } from "drizzle-orm"
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, openSync } from "node:fs"
import { join } from "node:path"

import type { RuntimeProvider, RuntimeHealth } from "../../core/runtime-provider"
import type { RuntimeClient } from "../../core/runtime-client"
import { db } from "../../db/index"
import { repos } from "../../db/schema"
import { syncSessionsList, syncMessagesList } from "../../db/sync"
import { logger } from "../../middleware/logger"

import { injectMcpConfig, removeMcpConfig } from "./mcp"
import { HttpRuntimeClient } from "./client"
import { openCodeCredentialWriter } from "./credential"

const RUNTIME_ID = "opencode"

// ---------------------------------------------------------------------------
// Port allocation range
// ---------------------------------------------------------------------------

const PORT_BASE = 8081
const PORT_MAX = 8199

// ---------------------------------------------------------------------------
// PID file — one file per runtime so multiple runtimes never step on each
// other's tracked processes.
// ---------------------------------------------------------------------------

const PID_DIR = join("/tmp", "fourth-spark")
const PID_FILE = join(PID_DIR, "pid-map.opencode.json")

interface PidRecord {
  pid: number
  port: number
  repoId: string
}

interface ManagedRepo {
  id: string
  localPath: string
  port: number
  process: Subprocess
  client: HttpRuntimeClient
}

// ---------------------------------------------------------------------------
// Stateless helpers (do not touch the per-instance `managed` map)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createOpenCodeProvider(serverPort: number): RuntimeProvider {
  const managed = new Map<string, ManagedRepo>()
  const startingLocks = new Map<string, Promise<RuntimeClient>>()
  let adoptionPromise: Promise<Map<string, PidRecord>> | undefined

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
      // pgrep unavailable — non-fatal
    }

    if (adopted.size > 0) {
      logger.info({ count: adopted.size }, "adopted live opencode processes from previous run")
    }

    return adopted
  }

  function ensureAdoption(): Promise<Map<string, PidRecord>> {
    if (!adoptionPromise) {
      adoptionPromise = adoptOrphans()
    }
    return adoptionPromise
  }

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

  async function initialSync(client: RuntimeClient, repoId: string): Promise<void> {
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

  async function spawnOpenCode(repoId: string, localPath: string, port: number): Promise<ManagedRepo> {
    logger.info({ repoId, localPath, port }, "spawning opencode serve")

    injectMcpConfig(localPath, repoId, serverPort)

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
    const client = new HttpRuntimeClient(baseUrl, localPath)

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

  async function startRepo(repoId: string, localPath: string): Promise<RuntimeClient> {
    const existing = managed.get(repoId)
    if (existing) return existing.client

    const inflight = startingLocks.get(repoId)
    if (inflight) return inflight

    const promise = (async () => {
      try {
        const adopted = await ensureAdoption()
        const record = adopted.get(repoId)
        if (record) {
          const baseUrl = `http://127.0.0.1:${record.port}`
          const client = new HttpRuntimeClient(baseUrl, localPath)
          const fakeProc = { pid: record.pid, kill: () => killPid(record.pid) } as unknown as Subprocess
          const entry: ManagedRepo = { id: repoId, localPath, port: record.port, process: fakeProc, client }
          managed.set(repoId, entry)
          writePidFile()
          logger.info({ repoId, port: record.port, pid: record.pid }, "reusing adopted opencode process")
          return client
        }

        const port = await allocatePort()
        const entry = await spawnOpenCode(repoId, localPath, port)
        return entry.client
      } finally {
        startingLocks.delete(repoId)
      }
    })()

    startingLocks.set(repoId, promise)
    return promise
  }

  async function stopRepo(repoId: string): Promise<void> {
    const entry = managed.get(repoId)
    if (!entry) return
    logger.info({ repoId, port: entry.port }, "stopping opencode serve")
    entry.process.kill()
    managed.delete(repoId)
    writePidFile()
    removeMcpConfig(entry.localPath)
    await db.update(repos).set({ port: null, status: "inactive", updatedAt: Date.now() }).where(eq(repos.id, repoId))
  }

  return {
    id: RUNTIME_ID,
    credentialWriter: openCodeCredentialWriter,

    async initialize(repoId: string, localPath: string): Promise<void> {
      await startRepo(repoId, localPath)
    },

    async teardown(repoId: string): Promise<void> {
      await stopRepo(repoId)
    },

    isReady(repoId: string): boolean {
      return managed.has(repoId)
    },

    getClient(repoId: string): RuntimeClient | null {
      return managed.get(repoId)?.client ?? null
    },

    async healthCheck(repoId: string): Promise<RuntimeHealth> {
      const entry = managed.get(repoId)
      if (!entry) return { reachable: false }
      const ok = await verifyOpenCodeIdentity(entry.port, entry.localPath)
      return {
        reachable: ok,
        details: { port: entry.port, pid: entry.process.pid, localPath: entry.localPath },
      }
    },

    injectMcp(localPath: string, repoId: string, port: number): void {
      injectMcpConfig(localPath, repoId, port)
    },

    removeMcp(localPath: string): void {
      removeMcpConfig(localPath)
    },

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
}

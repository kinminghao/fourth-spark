import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { logger } from "../middleware/logger"

const DEFAULT_LOCK_PATH = join(homedir(), ".fourth-spark", "server.lock")
const HEARTBEAT_MS = 10_000
const STALE_MS = 45_000

export type InstanceLockInfo = {
  pid: number
  token: string
  startedAt: number
  role: "serve" | "account"
  port?: number
  host?: string
  at: number
}

export class InstanceLockError extends Error {
  readonly holder: InstanceLockInfo

  constructor(holder: InstanceLockInfo, label = "fourth-spark server") {
    super(
      `another ${label} is already running (pid ${holder.pid}, role ${holder.role}${holder.port ? `, port ${holder.port}` : ""})`,
    )
    this.name = "InstanceLockError"
    this.holder = holder
  }
}

export type InstanceLock = {
  info: InstanceLockInfo
  release: () => Promise<void>
}

function parseLock(raw: string): InstanceLockInfo | undefined {
  try {
    const value = JSON.parse(raw) as Partial<InstanceLockInfo>
    if (typeof value.pid !== "number" || !Number.isInteger(value.pid)) return undefined
    if (typeof value.token !== "string" || value.token.length === 0) return undefined
    if (value.role !== "serve" && value.role !== "account") return undefined
    return {
      pid: value.pid,
      token: value.token,
      startedAt: typeof value.startedAt === "number" ? value.startedAt : 0,
      role: value.role,
      ...(typeof value.port === "number" ? { port: value.port } : {}),
      ...(typeof value.host === "string" && value.host.length > 0 ? { host: value.host } : {}),
      at: typeof value.at === "number" ? value.at : 0,
    }
  } catch {
    return undefined
  }
}

async function isFresh(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => undefined)
  if (!info) return false
  return Date.now() - info.mtimeMs <= STALE_MS
}

export async function readInstanceLock(
  path = DEFAULT_LOCK_PATH,
): Promise<{ info: InstanceLockInfo | undefined; fresh: boolean }> {
  const raw = await readFile(path, "utf8").catch(() => undefined)
  const info = raw ? parseLock(raw) : undefined
  return { info, fresh: await isFresh(path) }
}

export async function acquireInstanceLock(
  role: InstanceLockInfo["role"],
  opts: { port?: number; host?: string; path?: string; label?: string } = {},
): Promise<InstanceLock> {
  const path = opts.path ?? DEFAULT_LOCK_PATH
  const token = randomUUID()
  const info: InstanceLockInfo = {
    pid: process.pid,
    token,
    startedAt: Date.now() - Math.round(process.uptime() * 1000),
    role,
    ...(opts.port !== undefined ? { port: opts.port } : {}),
    ...(opts.host ? { host: opts.host } : {}),
    at: Date.now(),
  }

  await mkdir(dirname(path), { recursive: true })

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await writeFile(path, JSON.stringify(info), { flag: "wx", mode: 0o600 })
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
      const { info: holder, fresh } = await readInstanceLock(path)
      if (fresh && holder) throw new InstanceLockError(holder, opts.label)
      const stalePath = `${path}.stale-${process.pid}-${Date.now()}`
      try {
        await rename(path, stalePath)
        await unlink(stalePath).catch(() => {})
        logger.warn({ path }, "instance-lock: removed stale lock")
      } catch {
        // Another process won the steal race; loop and retry.
      }
      if (attempt === 2) throw new InstanceLockError(holder ?? info, opts.label)
    }
  }

  const heartbeat = setInterval(() => {
    void (async () => {
      const raw = await readFile(path, "utf8").catch(() => undefined)
      if (!raw || parseLock(raw)?.token !== token) {
        clearInterval(heartbeat)
        logger.warn({ path }, "instance-lock: lock ownership lost; stopping heartbeat")
        return
      }
      const now = new Date()
      await utimes(path, now, now).catch((err) => {
        logger.warn({ error: err instanceof Error ? err.message : String(err) }, "instance-lock: heartbeat failed")
      })
    })()
  }, HEARTBEAT_MS)
  heartbeat.unref?.()

  return {
    info,
    async release(): Promise<void> {
      clearInterval(heartbeat)
      const raw = await readFile(path, "utf8").catch(() => undefined)
      if (!raw || parseLock(raw)?.token !== token) return
      await unlink(path).catch(() => undefined)
    },
  }
}

export async function clearInstanceLock(path = DEFAULT_LOCK_PATH, pid?: number): Promise<boolean> {
  const raw = await readFile(path, "utf8").catch(() => undefined)
  if (!raw) return false
  const info = parseLock(raw)
  if (pid !== undefined && info?.pid !== pid) return false
  if (pid === undefined && (await isFresh(path))) return false
  await unlink(path).catch(() => undefined)
  return true
}

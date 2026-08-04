/**
 * Cross-process advisory file lock.
 *
 * Ported from claude-accounts-pool/src/lockfile.ts to share the SAME lock protocol
 * (same path, same constants) so fourth-spark and the TUI plugin are mutually exclusive
 * when writing claude-accounts.json / auth.json.
 *
 * Mechanism: O_EXCL create — exactly one racer can create the file, so mutual exclusion
 * never depends on staleness or rename. Staleness reads the lockfile's mtime and assumes
 * a LOCAL data dir (monotonic wall clock; network-FS clock skew is out of scope).
 */

import { writeFile, stat, rename, unlink, readFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import { logger } from "../middleware/logger"

// Constants MUST match claude-accounts-pool/src/constants.ts exactly so both
// processes agree on when a lock is stale and how long to wait.
const LOCK_STALE_MS = 45_000
const LOCK_ACQUIRE_TIMEOUT_MS = 30_000
const LOCK_POLL_MS = 100

export class LockTimeoutError extends Error {
  constructor() {
    super("lock acquisition timed out (another process is holding the lock)")
    this.name = "LockTimeoutError"
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function acquireFileLock(lockPath: string): Promise<{ release: () => Promise<void> }> {
  const token = randomUUID()
  const payload = JSON.stringify({ pid: process.pid, token, at: Date.now() })
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS
  let contended = false

  for (;;) {
    try {
      await writeFile(lockPath, payload, { flag: "wx", mode: 0o600 })
      logger.debug({ lockPath }, "lock acquired")
      return { release: () => releaseFileLock(lockPath, token) }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === "EEXIST") {
        const st = await stat(lockPath).catch((statErr: NodeJS.ErrnoException) => {
          if (statErr.code === "ENOENT") return undefined
          throw statErr
        })
        if (!st) continue
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          const stalePath = `${lockPath}.stale-${process.pid}-${Date.now()}`
          try {
            await rename(lockPath, stalePath)
            await unlink(stalePath).catch(() => {})
            logger.warn("lock: stole stale lock")
          } catch {
            // lost the steal race
          }
          continue
        }
        if (Date.now() >= deadline) {
          logger.warn("lock: acquisition timed out")
          throw new LockTimeoutError()
        }
        if (!contended) {
          logger.debug("lock: contended, waiting")
          contended = true
        }
        await sleep(LOCK_POLL_MS + Math.random() * 50)
        continue
      }
      if (code === "ENOENT") {
        await mkdir(dirname(lockPath), { recursive: true })
        continue
      }
      throw err
    }
  }
}

async function releaseFileLock(lockPath: string, token: string): Promise<void> {
  let ours = false
  try {
    ours = (JSON.parse(await readFile(lockPath, "utf8")) as { token?: string }).token === token
  } catch {
    logger.warn("lock: release - could not verify ownership")
    return
  }
  if (!ours) {
    logger.warn("lock: release - lock was stolen, skipping unlink")
    return
  }
  try {
    await unlink(lockPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return
    logger.warn("lock: release failed, will self-heal via staleness")
  }
}

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const { release } = await acquireFileLock(lockPath)
  try {
    return await fn()
  } finally {
    await release()
  }
}

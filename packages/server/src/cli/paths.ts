import { join, resolve, dirname } from "node:path"
import { mkdirSync, existsSync } from "node:fs"
import { homedir } from "node:os"

const DATA_DIR = join(homedir(), ".fourth-spark")
const LOG_DIR = join(DATA_DIR, "logs")

export const PID_FILE = join(DATA_DIR, "fourth-spark.pid")
export const LOG_FILE = join(LOG_DIR, "server.log")

export function ensureDataDir(): void {
  mkdirSync(LOG_DIR, { recursive: true })
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function findDockerCompose(): string | null {
  const binaryDir = dirname(resolve(process.execPath))
  const nearBinary = resolve(binaryDir, "docker-compose.yml")
  if (existsSync(nearBinary)) return nearBinary

  const inCwd = resolve("docker-compose.yml")
  if (existsSync(inCwd)) return inCwd

  return null
}

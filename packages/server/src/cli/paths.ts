import { join, resolve, dirname } from "node:path"
import { mkdirSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
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

export function getDockerComposeCmd(): string[] | null {
  try {
    execSync("docker compose version", { stdio: "pipe" })
    return ["docker", "compose"]
  } catch {
    try {
      execSync("docker-compose version", { stdio: "pipe" })
      return ["docker-compose"]
    } catch {
      return null
    }
  }
}

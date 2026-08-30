import { join, resolve, dirname } from "node:path"
import { mkdirSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import { homedir } from "node:os"

export const DATA_DIR = join(homedir(), ".fourth-spark")
const LOG_DIR = join(DATA_DIR, "logs")

export const PID_FILE = join(DATA_DIR, "fourth-spark.pid")
export const LOG_FILE = join(LOG_DIR, "server.log")

/** Single log file size cap in bytes (5 MB). */
export const MAX_LOG_BYTES = 5 * 1024 * 1024

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

// ---------------------------------------------------------------------------
// Pre-flight dependency check — call before starting the server.
// Exits with a clear error listing if any critical dependency is missing.
// ---------------------------------------------------------------------------

export function ensureDependencies(): void {
  const errors: string[] = []

  try {
    execSync("git --version", { stdio: "pipe" })
  } catch {
    errors.push(
      "git is not installed\n" +
      "  Install: https://git-scm.com/downloads",
    )
  }

  if (!process.env.DATABASE_URL) {
    let dockerOk = false
    try {
      execSync("docker --version", { stdio: "pipe" })
      dockerOk = true
    } catch {
      errors.push(
        "Docker is not installed (required for PostgreSQL)\n" +
        "  Install: https://docs.docker.com/get-docker/\n" +
        "  Or set DATABASE_URL to use an external PostgreSQL",
      )
    }

    if (dockerOk && !getDockerComposeCmd()) {
      errors.push(
        "Docker Compose is not available\n" +
        "  Usually included with Docker Desktop\n" +
        "  Or set DATABASE_URL to use an external PostgreSQL",
      )
    }
  }

  if (errors.length > 0) {
    console.error("Cannot start: missing required dependencies\n")
    for (const msg of errors) {
      console.error(`  ✗ ${msg}`)
    }
    console.error()
    process.exit(1)
  }
}

import { spawn, execSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, openSync } from "node:fs"
import { createServer } from "node:net"
import { PID_FILE, LOG_FILE, ensureDataDir, isProcessRunning, findDockerCompose, getDockerComposeCmd } from "./paths"

const DEFAULT_PORT = 3000
const PG_PORT = 5432

function parsePort(args: string[]): number | null {
  const idx = args.indexOf("--port")
  if (idx === -1 || idx + 1 >= args.length) return null
  const val = parseInt(args[idx + 1], 10)
  return isNaN(val) ? null : val
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once("error", () => resolve(false))
    srv.listen(port, "0.0.0.0", () => { srv.close(() => resolve(true)) })
  })
}

async function findFreePort(start: number): Promise<number> {
  for (let p = start; p < start + 100; p++) {
    if (await isPortFree(p)) return p
  }
  throw new Error(`No free port found in range ${start}-${start + 99}`)
}

function isPortOccupiedByOther(port: number, containerName: string): boolean {
  try {
    const out = execSync(`lsof -i :${port} -P -n -t 2>/dev/null`, { stdio: "pipe" }).toString().trim()
    if (!out) return false
    try {
      const containerId = execSync(`docker inspect --format '{{.State.Pid}}' ${containerName} 2>/dev/null`, { stdio: "pipe" }).toString().trim()
      return !out.split("\n").some((pid) => pid === containerId)
    } catch {
      return true
    }
  } catch {
    return false
  }
}

export async function startCommand(args: string[]): Promise<void> {
  ensureDataDir()

  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10)
    if (!isNaN(pid) && isProcessRunning(pid)) {
      console.log(`fourth-spark is already running (PID ${pid})`)
      console.log("Run 'fourth-spark stop' first.")
      process.exit(1)
    }
  }

  const composePath = findDockerCompose()
  const composeCmd = getDockerComposeCmd()
  if (composePath && composeCmd && !process.env.DATABASE_URL) {
    if (isPortOccupiedByOther(PG_PORT, "fourth-spark-db")) {
      console.error(`ERROR: Port ${PG_PORT} is already in use by another process.`)
      console.error("Options:")
      console.error(`  1. Stop the process using port ${PG_PORT}`)
      console.error("  2. Use an external database: DATABASE_URL=postgresql://... fourth-spark start")
      process.exit(1)
    }

    console.log("→ Starting PostgreSQL...")
    try {
      execSync(`${composeCmd.join(" ")} -f "${composePath}" up -d postgres`, { stdio: "pipe" })
      let ready = false
      for (let i = 0; i < 30; i++) {
        try {
          execSync("docker exec fourth-spark-db pg_isready -U fourth_spark -q", { stdio: "pipe" })
          ready = true
          break
        } catch {
          await new Promise((r) => setTimeout(r, 500))
        }
      }
      console.log(ready ? "  PostgreSQL ready" : "  Warning: PostgreSQL may not be ready")
    } catch {
      console.error("ERROR: Could not start PostgreSQL via Docker.")
      console.error("Make sure Docker is running, then retry.")
      process.exit(1)
    }
  }

  const requestedPort = parsePort(args)
  let port: number

  if (requestedPort) {
    if (!(await isPortFree(requestedPort))) {
      console.error(`ERROR: Port ${requestedPort} is already in use.`)
      process.exit(1)
    }
    port = requestedPort
  } else {
    if (await isPortFree(DEFAULT_PORT)) {
      port = DEFAULT_PORT
    } else {
      port = await findFreePort(DEFAULT_PORT + 1)
      console.log(`  Port ${DEFAULT_PORT} in use, using ${port}`)
    }
  }

  console.log("→ Starting fourth-spark server...")
  const binary = process.execPath
  const logFd = openSync(LOG_FILE, "a")
  const child = spawn(binary, ["serve"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, PORT: String(port) },
  })
  child.unref()

  const pid = child.pid
  if (!pid) {
    console.error("ERROR: Failed to start server")
    process.exit(1)
  }

  writeFileSync(PID_FILE, String(pid))

  await new Promise((r) => setTimeout(r, 1000))
  if (isProcessRunning(pid)) {
    console.log("")
    console.log("=== fourth-spark started ===")
    console.log(`  PID:  ${pid}`)
    console.log(`  URL:  http://localhost:${port}`)
    console.log(`  Logs: ${LOG_FILE}`)
    console.log("")
    console.log("  fourth-spark stop    — stop all services")
    console.log("  fourth-spark status  — check status")
  } else {
    console.error(`ERROR: Server failed to start. Check ${LOG_FILE}`)
    process.exit(1)
  }
}

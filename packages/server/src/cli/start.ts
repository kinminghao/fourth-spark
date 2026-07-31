import { spawn, execSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, openSync } from "node:fs"
import { PID_FILE, LOG_FILE, ensureDataDir, isProcessRunning, findDockerCompose } from "./paths"
import { PORT } from "../lib/config"

export async function startCommand(): Promise<void> {
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
  if (composePath && !process.env.DATABASE_URL) {
    console.log("→ Starting PostgreSQL...")
    try {
      execSync(`docker compose -f "${composePath}" up -d postgres`, { stdio: "pipe" })
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
      console.log("  Warning: Could not start PostgreSQL via Docker")
      console.log("  Set DATABASE_URL to use an external database")
    }
  }

  console.log("→ Starting fourth-spark server...")
  const binary = process.execPath
  const logFd = openSync(LOG_FILE, "a")
  const child = spawn(binary, ["serve"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
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
    console.log(`  URL:  http://localhost:${PORT}`)
    console.log(`  Logs: ${LOG_FILE}`)
    console.log("")
    console.log("  fourth-spark stop    — stop all services")
    console.log("  fourth-spark status  — check status")
  } else {
    console.error(`ERROR: Server failed to start. Check ${LOG_FILE}`)
    process.exit(1)
  }
}

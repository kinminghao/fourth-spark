import { readFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import { PID_FILE, LOG_FILE, isProcessRunning } from "./paths"
import { PORT, APP_VERSION } from "../lib/config"

export async function statusCommand(): Promise<void> {
  console.log(`fourth-spark ${APP_VERSION}`)
  console.log("")

  let serverPid: number | null = null
  let serverRunning = false

  if (existsSync(PID_FILE)) {
    serverPid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10)
    serverRunning = !isNaN(serverPid) && isProcessRunning(serverPid)
  }

  console.log(serverRunning ? `Server:     running (PID ${serverPid})` : "Server:     stopped")

  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (res.ok) {
      const data = (await res.json()) as { status: string; version?: string }
      console.log(`API:        reachable (${data.version ?? "unknown"})`)
    } else {
      console.log("API:        unreachable")
    }
  } catch {
    console.log("API:        unreachable")
  }

  try {
    execSync("docker exec fourth-spark-db pg_isready -U fourth_spark -q", { stdio: "pipe" })
    console.log("PostgreSQL: running")
  } catch {
    console.log("PostgreSQL: stopped (or not using Docker)")
  }

  try {
    const output = execSync("pgrep -f 'opencode serve --port'", { stdio: "pipe" }).toString().trim()
    const count = output.split("\n").filter(Boolean).length
    console.log(`OpenCode:   ${count} process${count !== 1 ? "es" : ""}`)
  } catch {
    console.log("OpenCode:   no processes")
  }

  console.log("")
  console.log(`Logs: ${LOG_FILE}`)
}

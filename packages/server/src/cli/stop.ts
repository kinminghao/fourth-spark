import { readFileSync, existsSync, unlinkSync } from "node:fs"
import { execSync } from "node:child_process"
import { PID_FILE, isProcessRunning, findDockerCompose } from "./paths"

export async function stopCommand(): Promise<void> {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10)
    if (!isNaN(pid) && isProcessRunning(pid)) {
      console.log(`→ Stopping fourth-spark server (PID ${pid})...`)
      process.kill(pid, "SIGTERM")

      for (let i = 0; i < 10; i++) {
        if (!isProcessRunning(pid)) break
        await new Promise((r) => setTimeout(r, 500))
      }

      if (isProcessRunning(pid)) {
        console.log("  Force killing...")
        try { process.kill(pid, "SIGKILL") } catch {}
      }
      console.log("  Server stopped")
    } else {
      console.log("  Server not running (stale PID file)")
    }
    unlinkSync(PID_FILE)
  } else {
    try {
      execSync("pgrep -x fourth-spark", { stdio: "pipe" })
      console.log("→ Stopping fourth-spark server (found by process name)...")
      try { execSync("pkill -x fourth-spark", { stdio: "pipe" }) } catch {}
      await new Promise((r) => setTimeout(r, 1000))
      try { execSync("pkill -9 -x fourth-spark", { stdio: "pipe" }) } catch {}
      console.log("  Server stopped")
    } catch {
      console.log("  No fourth-spark server running")
    }
  }

  try {
    execSync("pgrep -f 'opencode serve --port'", { stdio: "pipe" })
    console.log("→ Stopping opencode processes...")
    try { execSync("pkill -f 'opencode serve --port'", { stdio: "pipe" }) } catch {}
    console.log("  Done")
  } catch {
    // no opencode processes running
  }

  const composePath = findDockerCompose()
  if (composePath) {
    console.log("→ Stopping PostgreSQL...")
    try {
      execSync(`docker compose -f "${composePath}" down`, { stdio: "inherit" })
    } catch {}
  }

  console.log("")
  console.log("=== All services stopped ===")
}

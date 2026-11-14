import { spawn } from "node:child_process"
import { existsSync, openSync, readFileSync, statSync, truncateSync, unlinkSync, writeFileSync } from "node:fs"
import { ACCOUNT_POOL_DEFAULT_HOST, ACCOUNT_POOL_DEFAULT_PORT } from "../account/constants"
import { clearInstanceLock, readInstanceLock } from "../lib/instance-lock"
import {
  ACCOUNT_LOG_FILE,
  ACCOUNT_PID_FILE,
  ACCOUNT_PORT_FILE,
  ensureDataDir,
  ensureDependencies,
  isProcessRunning,
  MAX_LOG_BYTES,
} from "./paths"

const DEFAULT_READY_TIMEOUT_MS = 120_000
const READY_POLL_MS = 500

type AccountServeOptions = { port: number; host: string }

function parseFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1 || index + 1 >= args.length) return undefined
  return args[index + 1]
}

export function parseOptions(args: string[]): AccountServeOptions | { error: string } {
  const rawPort = parseFlag(args, "--port")
  const port = rawPort === undefined ? ACCOUNT_POOL_DEFAULT_PORT : Number.parseInt(rawPort, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: `invalid --port: ${rawPort ?? ""}` }
  }
  const host = parseFlag(args, "--host") ?? ACCOUNT_POOL_DEFAULT_HOST
  if (host.trim().length === 0) return { error: "invalid --host" }
  return { port, host: host.trim() }
}

function readNumberFile(path: string): number | undefined {
  if (!existsSync(path)) return undefined
  const value = Number.parseInt(readFileSync(path, "utf8").trim(), 10)
  return Number.isNaN(value) ? undefined : value
}

function removeFile(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // already gone
  }
}

function probeHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1"
  if (host === "::1") return "[::1]"
  return host
}

async function probe(host: string, port: number, path: string, timeoutMs = 2_000): Promise<boolean> {
  try {
    const res = await fetch(`http://${probeHost(host)}:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

function tailLog(lines = 20): void {
  if (!existsSync(ACCOUNT_LOG_FILE)) return
  const content = readFileSync(ACCOUNT_LOG_FILE, "utf8").trimEnd().split("\n")
  console.error(`\nLast ${Math.min(lines, content.length)} lines of ${ACCOUNT_LOG_FILE}:`)
  for (const line of content.slice(-lines)) console.error(`  ${line}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForReady(host: string, port: number, pid: number): Promise<boolean> {
  const timeout = Number(process.env.ACCOUNT_POOL_READY_TIMEOUT_MS ?? DEFAULT_READY_TIMEOUT_MS)
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return false
    if (await probe(host, port, "/v1/health", 1_000)) return true
    await sleep(READY_POLL_MS)
  }
  return false
}

function processCommand(pid: number): string | undefined {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim()
  } catch {
    return undefined
  }
}

function looksLikeFourthSpark(pid: number): boolean {
  const command = processCommand(pid)
  if (command === undefined) return true
  return /fourth-spark|fourth_spark|src[\\/]cli|account\s+serve/.test(command)
}

function devEntry(): string | undefined {
  const entry = process.argv[1]
  return entry && /\.(?:ts|js)$/.test(entry) ? entry : undefined
}

function printUsage(): void {
  console.log(`Usage: fourth-spark account <command> [options]

Commands:
  serve     Start the account pool master in the foreground [--port PORT] [--host HOST]
  start     Start the account pool master in the background [--port PORT] [--host HOST]
  stop      Stop the background account pool master
  status    Show account pool status

Defaults: host ${ACCOUNT_POOL_DEFAULT_HOST}, port ${ACCOUNT_POOL_DEFAULT_PORT}`)
}

async function accountServe(args: string[]): Promise<void> {
  const options = parseOptions(args)
  if ("error" in options) {
    console.error(options.error)
    process.exit(1)
  }

  const lock = await readInstanceLock()
  if (lock.fresh && lock.info) {
    console.error(
      `Cannot start: another fourth-spark server is running (pid ${lock.info.pid}, role ${lock.info.role}).`,
    )
    process.exit(1)
  }

  console.log(`fourth-spark account pool master
  UI:     http://${options.host === "0.0.0.0" ? "127.0.0.1" : options.host}:${options.port}
  Pool:   http://${options.host}:${options.port}/v1/health
  Log:    ${ACCOUNT_LOG_FILE}`)

  process.env.ACCOUNT_POOL_MASTER = "1"
  process.env.PORT = String(options.port)
  process.env.FOURTH_SPARK_HOST = options.host
  ensureDependencies({ requireOpencode: false })
  await import("../index")
}

async function accountStart(args: string[]): Promise<void> {
  const options = parseOptions(args)
  if ("error" in options) {
    console.error(options.error)
    process.exit(1)
  }

  const existing = readNumberFile(ACCOUNT_PID_FILE)
  if (existing && isProcessRunning(existing)) {
    console.log(`Account pool already running (PID ${existing})`)
    return
  }

  const lock = await readInstanceLock()
  if (lock.fresh && lock.info) {
    console.error(
      `Cannot start: another fourth-spark server is running (pid ${lock.info.pid}, role ${lock.info.role}).`,
    )
    process.exit(1)
  }

  ensureDataDir()
  if (existsSync(ACCOUNT_LOG_FILE) && statSync(ACCOUNT_LOG_FILE).size > MAX_LOG_BYTES) {
    truncateSync(ACCOUNT_LOG_FILE, 0)
  }

  const logFd = openSync(ACCOUNT_LOG_FILE, "a")
  const entry = devEntry()
  const serverArgs = [
    ...(entry ? [entry] : []),
    "account",
    "serve",
    "--port",
    String(options.port),
    "--host",
    options.host,
  ]
  const child = spawn(process.execPath, serverArgs, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      ACCOUNT_POOL_MASTER: "1",
      PORT: String(options.port),
      FOURTH_SPARK_HOST: options.host,
    },
  })
  child.unref()

  if (child.pid === undefined) {
    console.error("Failed to spawn account pool master")
    tailLog()
    process.exit(1)
  }

  writeFileSync(ACCOUNT_PID_FILE, String(child.pid))
  writeFileSync(ACCOUNT_PORT_FILE, String(options.port))

  const ready = await waitForReady(options.host, options.port, child.pid)
  if (!ready) {
    console.error(`Account pool did not become ready (PID ${child.pid})`)
    tailLog()
    if (!isProcessRunning(child.pid)) {
      removeFile(ACCOUNT_PID_FILE)
      removeFile(ACCOUNT_PORT_FILE)
      process.exit(1)
    }
    process.exit(1)
  }

  console.log(`Account pool started
  PID:    ${child.pid}
  UI:     http://${options.host === "0.0.0.0" ? "127.0.0.1" : options.host}:${options.port}
  Pool:   http://${options.host}:${options.port}/v1/health
  Log:    ${ACCOUNT_LOG_FILE}`)
}

async function accountStop(): Promise<void> {
  const lock = await readInstanceLock()
  const pid =
    readNumberFile(ACCOUNT_PID_FILE) ?? (lock.fresh && lock.info?.role === "account" ? lock.info.pid : undefined)

  if (pid === undefined) {
    console.log("Account pool is not running")
    removeFile(ACCOUNT_PORT_FILE)
    return
  }

  if (!isProcessRunning(pid)) {
    console.log(`Account pool is not running (stale PID ${pid})`)
    removeFile(ACCOUNT_PID_FILE)
    removeFile(ACCOUNT_PORT_FILE)
    await clearInstanceLock(undefined, pid)
    return
  }

  if (!looksLikeFourthSpark(pid)) {
    console.error(`Refusing to stop PID ${pid}: it does not look like fourth-spark (possible PID reuse).`)
    return
  }

  process.kill(pid, "SIGTERM")
  for (let i = 0; i < 20; i++) {
    if (!isProcessRunning(pid)) break
    await sleep(500)
  }
  if (isProcessRunning(pid)) {
    process.kill(pid, "SIGKILL")
    await sleep(200)
  }

  removeFile(ACCOUNT_PID_FILE)
  removeFile(ACCOUNT_PORT_FILE)
  await clearInstanceLock(undefined, pid)
  console.log(`Account pool stopped (PID ${pid})`)
}

async function accountStatus(): Promise<void> {
  const lock = await readInstanceLock()
  const pid =
    readNumberFile(ACCOUNT_PID_FILE) ?? (lock.fresh && lock.info?.role === "account" ? lock.info.pid : undefined)
  const port =
    readNumberFile(ACCOUNT_PORT_FILE) ??
    (lock.fresh && lock.info?.role === "account" ? lock.info.port : undefined) ??
    ACCOUNT_POOL_DEFAULT_PORT
  const host = probeHost(
    (lock.fresh && lock.info?.role === "account" ? lock.info.host : undefined) ?? ACCOUNT_POOL_DEFAULT_HOST,
  )
  const running = pid !== undefined && isProcessRunning(pid)

  console.log(`Account pool: ${running ? `running (PID ${pid})` : "stopped"}`)
  if (!running) return

  const [poolHealthy, uiHealthy] = await Promise.all([probe(host, port, "/v1/health"), probe(host, port, "/", 3_000)])
  console.log(`  Pool:     ${poolHealthy ? "healthy" : "not responding"} (http://${host}:${port}/v1/health)`)
  console.log(`  UI:       ${uiHealthy ? "healthy" : "not responding"} (http://${host}:${port})`)
  console.log(`  Log:      ${ACCOUNT_LOG_FILE}`)

  for (const provider of ["anthropic", "openai", "opencode-go"]) {
    try {
      const res = await fetch(`http://${host}:${port}/v1/usage?provider=${provider}`, {
        signal: AbortSignal.timeout(2_000),
      })
      if (!res.ok) continue
      const snapshot = (await res.json()) as { accounts?: Array<{ holders?: string[]; needsReauth?: boolean }> }
      const accounts = snapshot.accounts ?? []
      const leased = accounts.filter((account) => (account.holders ?? []).length > 0).length
      const needsReauth = accounts.filter((account) => account.needsReauth === true).length
      console.log(
        `  ${provider.padEnd(12)} ${accounts.length} accounts, ${leased} leased${needsReauth > 0 ? `, ${needsReauth} need reauth` : ""}`,
      )
    } catch {
      // best-effort
    }
  }
}

export async function accountCommand(args: string[]): Promise<void> {
  const subcommand = args[0]
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    printUsage()
    return
  }
  if (args.includes("--help") || args.includes("-h")) {
    printUsage()
    return
  }

  switch (subcommand) {
    case "serve":
      await accountServe(args.slice(1))
      break
    case "start":
      await accountStart(args.slice(1))
      break
    case "stop":
      await accountStop()
      break
    case "status":
      await accountStatus()
      break
    default:
      console.error(`Unknown account command: ${subcommand}`)
      printUsage()
      process.exit(1)
  }
}

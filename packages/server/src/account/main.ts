import { Hono } from "hono"
import { ACCOUNT_LOCK_FILE } from "../cli/log-path"
import { acquireInstanceLock, readInstanceLock } from "../lib/instance-lock"
import { logger, requestLogger } from "../middleware/logger"
import { ACCOUNT_POOL_DEFAULT_HOST, ACCOUNT_POOL_DEFAULT_PORT } from "./constants"
import { poolProviderIds } from "./providers"
import { accountPoolRoutes } from "./routes"
import { accountPoolService } from "./service"

process.env.ACCOUNT_POOL_MASTER = "1"

const port = Number(process.env.ACCOUNT_POOL_PORT ?? ACCOUNT_POOL_DEFAULT_PORT)
const host = process.env.ACCOUNT_POOL_HOST?.trim() || ACCOUNT_POOL_DEFAULT_HOST

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`invalid ACCOUNT_POOL_PORT: ${process.env.ACCOUNT_POOL_PORT ?? ""}`)
  process.exit(1)
}

const app = new Hono()
app.use("*", requestLogger)
app.onError((err, c) => {
  logger.error({ err }, "account-pool: unhandled error")
  return c.json({ error: "internal error" }, 500)
})
app.route("/", accountPoolRoutes)
app.get("/", (c) => c.json({ name: "fourth-spark account pool", status: "ok" }))

const mainServer = await readInstanceLock()
if (mainServer.fresh && mainServer.info) {
  logger.warn(
    { pid: mainServer.info.pid, role: mainServer.info.role, port: mainServer.info.port },
    "account-pool: a main fourth-spark server is running; verify it does not use the same providers locally",
  )
}

const instanceLock = await acquireInstanceLock("account", {
  port,
  host,
  path: ACCOUNT_LOCK_FILE,
  label: "account pool master",
}).catch((err) => {
  logger.fatal({ err }, "account-pool: cannot acquire the account pool lock")
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

try {
  await accountPoolService.start()
} catch (err) {
  await instanceLock.release().catch(() => undefined)
  logger.fatal({ err }, "account-pool: failed to start")
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

const server = Bun.serve({
  port,
  hostname: host,
  idleTimeout: 0,
  fetch: app.fetch,
})

logger.info({ port: server.port, host, providers: [...poolProviderIds()] }, "account-pool: pool-only listener ready")

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, "account-pool: shutting down")
  await accountPoolService.stop().catch((err) => logger.warn({ err }, "account-pool: state flush failed"))
  await instanceLock.release().catch(() => undefined)
  server.stop(true)
  process.exit(0)
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGHUP", () => void shutdown("SIGHUP"))

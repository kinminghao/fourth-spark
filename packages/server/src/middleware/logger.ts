import { Writable } from "node:stream"
import type { MiddlewareHandler } from "hono"
import { pino } from "pino"
import { LOG_FILE } from "../cli/paths"
import { initRotatingLog, writeRotatingLog } from "../lib/log-rotate"

function createRotatingDestination(): Writable {
  initRotatingLog(LOG_FILE)
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        writeRotatingLog(chunk)
        callback()
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)))
      }
    },
  })
}

function createLogger() {
  const level = process.env.LOG_LEVEL ?? "info"
  if (process.env.LOG_PRETTY === "1") {
    return pino({
      level,
      transport: { target: "pino-pretty", options: { colorize: true } },
    })
  }
  return pino({ level }, createRotatingDestination())
}

export const logger = createLogger()

/** Strip sensitive query params (token) from a URL path for logging. */
function sanitizePath(raw: string, url: string): string {
  try {
    const u = new URL(url)
    if (u.searchParams.has("token")) {
      u.searchParams.set("token", "***")
      return u.pathname + u.search
    }
  } catch {
    // Malformed URL — fall through to raw path
  }
  return raw
}

// Logs method, path, status, and duration for every request as structured JSON.
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now()
  await next()
  logger.info(
    {
      method: c.req.method,
      path: sanitizePath(c.req.path, c.req.url),
      status: c.res.status,
      durationMs: Date.now() - start,
    },
    "request",
  )
}

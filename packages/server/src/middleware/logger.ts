import type { MiddlewareHandler } from "hono"
import { pino } from "pino"

function createLogger() {
  if (process.env.LOG_PRETTY === "1") {
    return pino({
      level: process.env.LOG_LEVEL ?? "info",
      transport: { target: "pino-pretty", options: { colorize: true } },
    })
  }
  return pino({ level: process.env.LOG_LEVEL ?? "info" })
}

// Shared structured logger instance (imported by index + error handler too).
export const logger = createLogger()

// Logs method, path, status, and duration for every request as structured JSON.
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now()
  await next()
  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
    },
    "request",
  )
}

import type { Context } from "hono"
import { RuntimeError } from "../core/runtime-types"
import { logger } from "./logger"

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message, status }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

// Global error handler (registered via app.onError). Converts any thrown error
// into a unified `{ error, status }` JSON body and logs it.
export function onError(err: Error, _c: Context): Response {
  if (err instanceof RuntimeError) {
    const status = err.status >= 400 && err.status <= 599 ? err.status : 502
    logger.error(
      { error: err.message, status, runtimeId: err.runtimeId, body: err.body.slice(0, 500) },
      "Runtime request failed",
    )
    return jsonError(err.message, status)
  }

  logger.error({ error: err.message, stack: err.stack }, "Unhandled error")
  return jsonError(err.message || "Internal Server Error", 500)
}

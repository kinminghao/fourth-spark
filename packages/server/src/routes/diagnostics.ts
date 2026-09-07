import { Hono } from "hono"
import { db } from "../db/index"
import { diagnostics } from "../db/schema"
import { desc } from "drizzle-orm"
import { logger } from "../middleware/logger"

export const diagnosticsRoutes = new Hono()

const MAX_BODY_SIZE = 256 * 1024

diagnosticsRoutes.post("/", async (c) => {
  const contentLength = parseInt(c.req.header("content-length") ?? "0", 10)
  if (contentLength > MAX_BODY_SIZE) {
    return c.json({ error: "payload too large" }, 413)
  }

  const body = await c.req.json<{
    userAgent?: string
    url?: string
    freezeDurationMs?: number
    metrics?: unknown
  }>()

  if (
    typeof body.freezeDurationMs !== "number" ||
    !body.metrics ||
    typeof body.metrics !== "object"
  ) {
    return c.json({ error: "invalid payload" }, 400)
  }

  const id = crypto.randomUUID()
  const now = Date.now()

  try {
    await db.insert(diagnostics).values({
      id,
      userAgent: body.userAgent ?? "unknown",
      url: body.url ?? "unknown",
      freezeDurationMs: body.freezeDurationMs,
      metrics: body.metrics as any,
      createdAt: now,
    })
    logger.warn(
      { id, freezeDurationMs: body.freezeDurationMs, url: body.url },
      "frontend freeze report received",
    )
    return c.json({ id })
  } catch (err) {
    logger.error({ err }, "failed to store freeze report")
    return c.json({ error: "storage failed" }, 500)
  }
})

diagnosticsRoutes.get("/", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200)
  const rows = await db
    .select()
    .from(diagnostics)
    .orderBy(desc(diagnostics.createdAt))
    .limit(limit)
  return c.json(rows)
})

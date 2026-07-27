import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { deviceTokens } from "../db/schema"
import { logger } from "../middleware/logger"

export const pushRoutes = new Hono()

pushRoutes.post("/register", async (c) => {
  const body = await c.req.json<{ token?: string; platform?: string }>().catch(() => null)
  if (!body || typeof body.token !== "string" || body.token.length === 0) {
    return c.json({ error: "Body must include a non-empty 'token' string" }, 400)
  }

  const platform = body.platform ?? "ios"
  const now = Date.now()
  const id = crypto.randomUUID()

  await db.insert(deviceTokens).values({
    id,
    token: body.token,
    platform,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: deviceTokens.token,
    set: { updatedAt: now },
  })

  logger.info({ platform, tokenPrefix: body.token.slice(0, 8) }, "push: device registered")
  return c.json({ ok: true }, 201)
})

pushRoutes.delete("/unregister", async (c) => {
  const body = await c.req.json<{ token?: string }>().catch(() => null)
  if (!body || typeof body.token !== "string" || body.token.length === 0) {
    return c.json({ error: "Body must include a non-empty 'token' string" }, 400)
  }

  await db.delete(deviceTokens).where(eq(deviceTokens.token, body.token))
  logger.info({ tokenPrefix: body.token.slice(0, 8) }, "push: device unregistered")
  return c.json({ ok: true })
})

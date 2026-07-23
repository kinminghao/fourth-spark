import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { settings } from "../db/schema"

export const settingsRoutes = new Hono()

settingsRoutes.get("/", async (c) => {
  const rows = await db.select().from(settings)
  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value
  return c.json(map)
})

settingsRoutes.put("/:key", async (c) => {
  const key = c.req.param("key")
  const body = await c.req.json<{ value?: string }>().catch(() => null)
  if (!body || typeof body.value !== "string") {
    return c.json({ error: "body must include a string 'value'" }, 400)
  }
  const now = Date.now()
  await db.insert(settings).values({ key, value: body.value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: body.value, updatedAt: now } })
  return c.json({ ok: true })
})

settingsRoutes.delete("/:key", async (c) => {
  await db.delete(settings).where(eq(settings.key, c.req.param("key")))
  return c.json({ ok: true })
})

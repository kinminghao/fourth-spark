import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { gitHosts } from "../db/schema"

export const gitHostRoutes = new Hono()

gitHostRoutes.get("/", async (c) => {
  const rows = await db.select().from(gitHosts)
  return c.json(rows.map((r) => ({ ...r, token: maskToken(r.token) })))
})

gitHostRoutes.post("/", async (c) => {
  const body = await c.req.json<{ host?: string; platform?: string; name?: string; token?: string }>().catch(() => null)
  if (!body?.host || !body?.token || !body?.name) {
    return c.json({ error: "host, name, and token are required" }, 400)
  }
  const now = Date.now()
  const id = crypto.randomUUID()
  const values = {
    id,
    host: body.host.toLowerCase().trim(),
    platform: body.platform ?? "gitea",
    name: body.name.trim(),
    token: body.token.trim(),
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(gitHosts).values(values)
  return c.json({ ...values, token: maskToken(values.token) }, 201)
})

gitHostRoutes.put("/:id", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{ host?: string; platform?: string; name?: string; token?: string }>().catch(() => null)
  if (!body) return c.json({ error: "empty body" }, 400)

  const updates: Record<string, unknown> = { updatedAt: Date.now() }
  if (body.host) updates.host = body.host.toLowerCase().trim()
  if (body.platform) updates.platform = body.platform
  if (body.name) updates.name = body.name.trim()
  if (body.token) updates.token = body.token.trim()

  await db.update(gitHosts).set(updates).where(eq(gitHosts.id, id))
  const [row] = await db.select().from(gitHosts).where(eq(gitHosts.id, id))
  if (!row) return c.json({ error: "not found" }, 404)
  return c.json({ ...row, token: maskToken(row.token) })
})

gitHostRoutes.delete("/:id", async (c) => {
  await db.delete(gitHosts).where(eq(gitHosts.id, c.req.param("id")))
  return c.json({ ok: true })
})

function maskToken(token: string): string {
  if (token.length <= 8) return "••••••••"
  return token.slice(0, 4) + "••••" + token.slice(-4)
}

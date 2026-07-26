import { Hono } from "hono"
import { eq, or, isNull, asc } from "drizzle-orm"
import { db } from "../db/index"
import { promptFragments } from "../db/schema"

export const globalFragments = new Hono()

globalFragments.get("/", async (c) => {
  const rows = await db.select().from(promptFragments)
    .where(isNull(promptFragments.repoId))
    .orderBy(asc(promptFragments.sortOrder), asc(promptFragments.createdAt))
  return c.json(rows)
})

globalFragments.post("/", async (c) => {
  const body = await c.req.json<{ name?: string; content?: string }>().catch(() => null)
  if (!body?.name) return c.json({ error: "name is required" }, 400)

  const now = Date.now()
  const row = {
    id: crypto.randomUUID(),
    name: body.name.trim(),
    content: body.content ?? "",
    repoId: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(promptFragments).values(row)
  return c.json(row, 201)
})

globalFragments.put("/:id", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{ name?: string; content?: string; sortOrder?: number }>().catch(() => null)
  if (!body) return c.json({ error: "empty body" }, 400)

  const updates: Record<string, unknown> = { updatedAt: Date.now() }
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.content !== undefined) updates.content = body.content
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder

  await db.update(promptFragments).set(updates).where(eq(promptFragments.id, id))
  const [row] = await db.select().from(promptFragments).where(eq(promptFragments.id, id))
  if (!row) return c.json({ error: "not found" }, 404)
  return c.json(row)
})

globalFragments.delete("/:id", async (c) => {
  await db.delete(promptFragments).where(eq(promptFragments.id, c.req.param("id")))
  return c.json({ ok: true })
})

export const repoFragments = new Hono()

repoFragments.get("/", async (c) => {
  const repoId = c.req.param("repoId")!
  const rows = await db.select().from(promptFragments)
    .where(or(isNull(promptFragments.repoId), eq(promptFragments.repoId, repoId)))
    .orderBy(asc(promptFragments.sortOrder), asc(promptFragments.createdAt))
  return c.json(rows)
})

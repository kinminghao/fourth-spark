import { Hono } from "hono"
import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { tags } from "../db/schema"
import { parseBody } from "../lib/validation"

export const tagRoutes = new Hono()

function tagId(repoId: string, name: string): string {
  return `${repoId}_tag_${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`
}

const CreateTagBody = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  description: z.string().optional(),
})

const UpdateTagBody = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
})

// GET /tags — list all tags for this repo
tagRoutes.get("/", async (c) => {
  const repoId = c.req.param("repoId")!
  const rows = await db.select().from(tags).where(eq(tags.repoId, repoId)).orderBy(tags.name)
  return c.json(rows)
})

// POST /tags — create a new tag
tagRoutes.post("/", async (c) => {
  const repoId = c.req.param("repoId")!
  const [body, err] = await parseBody(c, CreateTagBody)
  if (err) return err

  const name = body.name.trim()
  const id = tagId(repoId, name)
  const now = Date.now()

  const values = {
    id,
    repoId,
    name,
    color: body.color?.replace(/^#/, "") ?? "6b7280",
    description: body.description ?? null,
    createdAt: now,
  }

  await db.insert(tags).values(values).onConflictDoNothing()
  const [row] = await db.select().from(tags).where(eq(tags.id, id))
  return c.json(row, 201)
})

// PATCH /tags/:id — update a tag
tagRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id")!
  const [body, err] = await parseBody(c, UpdateTagBody)
  if (err) return err

  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.color !== undefined) updates.color = body.color.replace(/^#/, "")
  if (body.description !== undefined) updates.description = body.description

  if (Object.keys(updates).length === 0) return c.json({ error: "nothing to update" }, 400)

  await db.update(tags).set(updates).where(eq(tags.id, id))
  const [row] = await db.select().from(tags).where(eq(tags.id, id))
  if (!row) return c.json({ error: "tag not found" }, 404)
  return c.json(row)
})

// DELETE /tags/:id — delete a tag (cascade removes issue_tags)
tagRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id")!
  const [row] = await db.select().from(tags).where(eq(tags.id, id))
  if (!row) return c.json({ error: "tag not found" }, 404)
  await db.delete(tags).where(eq(tags.id, id))
  return c.json({ ok: true })
})



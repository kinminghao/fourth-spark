import { Hono } from "hono"
import { eq, and, inArray } from "drizzle-orm"
import { db } from "../db/index"
import { tags, issueTags, issues } from "../db/schema"

export const tagRoutes = new Hono()

function tagId(repoId: string, name: string): string {
  return `${repoId}_tag_${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`
}

// GET /tags — list all tags for this repo
tagRoutes.get("/", async (c) => {
  const repoId = c.req.param("repoId")!
  const rows = await db.select().from(tags).where(eq(tags.repoId, repoId)).orderBy(tags.name)
  return c.json(rows)
})

// POST /tags — create a new tag
tagRoutes.post("/", async (c) => {
  const repoId = c.req.param("repoId")!
  const body = await c.req.json<{ name: string; color?: string; description?: string }>().catch(() => null)
  if (!body?.name?.trim()) return c.json({ error: "name is required" }, 400)

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
  const body = await c.req.json<{ name?: string; color?: string; description?: string }>().catch(() => null)
  if (!body) return c.json({ error: "empty body" }, 400)

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

// PUT /issues/:number/tags — set tags for an issue (full replace)
tagRoutes.put("/issues/:number/tags", async (c) => {
  const repoId = c.req.param("repoId")!
  const number = Number(c.req.param("number"))
  if (!Number.isFinite(number)) return c.json({ error: "invalid issue number" }, 400)

  const body = await c.req.json<{ tagIds: string[] }>().catch(() => null)
  if (!body || !Array.isArray(body.tagIds)) return c.json({ error: "tagIds array is required" }, 400)

  const issueIdVal = `${repoId}_${number}`

  // Verify issue exists
  const [issue] = await db.select({ id: issues.id }).from(issues).where(eq(issues.id, issueIdVal))
  if (!issue) return c.json({ error: "issue not found" }, 404)

  // Remove existing tags, then insert new ones
  await db.delete(issueTags).where(eq(issueTags.issueId, issueIdVal))

  if (body.tagIds.length > 0) {
    const rows = body.tagIds.map((tid) => ({ issueId: issueIdVal, tagId: tid }))
    await db.insert(issueTags).values(rows).onConflictDoNothing()
  }

  // Return the issue's current tags
  const currentTags = await db
    .select({ tag: tags })
    .from(issueTags)
    .innerJoin(tags, eq(issueTags.tagId, tags.id))
    .where(eq(issueTags.issueId, issueIdVal))

  return c.json(currentTags.map((r) => r.tag))
})

// GET /issues/:number/tags — get tags for an issue
tagRoutes.get("/issues/:number/tags", async (c) => {
  const repoId = c.req.param("repoId")!
  const number = Number(c.req.param("number"))
  if (!Number.isFinite(number)) return c.json({ error: "invalid issue number" }, 400)

  const issueIdVal = `${repoId}_${number}`
  const rows = await db
    .select({ tag: tags })
    .from(issueTags)
    .innerJoin(tags, eq(issueTags.tagId, tags.id))
    .where(eq(issueTags.issueId, issueIdVal))

  return c.json(rows.map((r) => r.tag))
})

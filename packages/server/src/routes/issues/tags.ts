import { Hono } from "hono"
import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "../../db/index"
import { tags, issueTags, issues } from "../../db/schema"
import { parseBody } from "../../lib/validation"

const SetIssueTagsBody = z.object({
  tagIds: z.array(z.string()),
})

export function registerTagRoutes(app: Hono) {
  // PUT /:number/tags — set tags for an issue (full replace)
  app.put("/:number/tags", async (c) => {
    const repoId = c.req.param("repoId")!
    const number = Number(c.req.param("number"))
    if (!Number.isFinite(number)) return c.json({ error: "invalid issue number" }, 400)

    const [body, err] = await parseBody(c, SetIssueTagsBody)
    if (err) return err

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

  // GET /:number/tags — get tags for an issue
  app.get("/:number/tags", async (c) => {
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
}

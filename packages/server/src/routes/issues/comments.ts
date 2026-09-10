import { Hono } from "hono"
import { eq, asc } from "drizzle-orm"
import { unlink } from "node:fs/promises"
import { db } from "../../db/index"
import { issues, issueComments } from "../../db/schema"
import { parseBody } from "../../lib/validation"
import {
  CreateCommentBody,
  draftPath,
  rewriteAttachmentUrls,
  issueId,
  commentToDb,
  getRepoGitClient,
} from "./helpers"

export function registerCommentRoutes(app: Hono): void {
  app.get("/:number/comments", async (c) => {
    const repoId = c.req.param("repoId")!
    const number = Number(c.req.param("number"))
    if (!Number.isFinite(number)) return c.json({ error: "invalid issue number" }, 400)

    const iid = issueId(repoId, number)
    const rows = await db.select().from(issueComments).where(eq(issueComments.issueId, iid)).orderBy(asc(issueComments.createdAt))

    if (rows.length > 0) {
      const mapped = rows.map((r) => ({
        id: r.id,
        body: rewriteAttachmentUrls(r.body, repoId) ?? "",
        user: { login: r.authorLogin, avatar_url: r.authorAvatar ?? "" },
        created_at: new Date(r.createdAt).toISOString(),
        updated_at: new Date(r.updatedAt).toISOString(),
      }))
      return c.json(mapped)
    }

    const ctx = await getRepoGitClient(repoId)
    if (!ctx) return c.json([])

    const comments = await ctx.client.listComments(number)
    const rewritten = comments.map((c) => ({ ...c, body: rewriteAttachmentUrls(c.body, repoId) ?? "" }))
    return c.json(rewritten)
  })

  // ---------------------------------------------------------------------------
  // 发布评论 — 调 git provider + 存 DB + 删临时文件
  // ---------------------------------------------------------------------------

  app.post("/:number/comments", async (c) => {
    const repoId = c.req.param("repoId")!
    const number = Number(c.req.param("number"))
    if (!Number.isFinite(number)) return c.json({ error: "invalid issue number" }, 400)

    const [body, err] = await parseBody(c, CreateCommentBody)
    if (err) return err
    if (!body.body.trim()) return c.json({ error: "comment body is required" }, 400)

    const ctx = await getRepoGitClient(repoId)
    if (!ctx) return c.json({ error: "Repo not found or git host not configured" }, 400)

    const gc = await ctx.client.createComment(number, body.body)

    const values = commentToDb(repoId, number, gc)
    const { id: _, createdAt: __, ...updateSet } = values
    await db.insert(issueComments).values(values).onConflictDoUpdate({ target: issueComments.id, set: updateSet })

    const iid = issueId(repoId, number)
    const commentRows = await db.select({ id: issueComments.id }).from(issueComments).where(eq(issueComments.issueId, iid))
    await db.update(issues).set({ commentCount: commentRows.length }).where(eq(issues.id, iid))

    const filePath = draftPath(repoId, number)
    await unlink(filePath).catch(() => {})

    return c.json({
      id: gc.id,
      body: gc.body,
      user: gc.user,
      created_at: gc.created_at,
      updated_at: gc.updated_at,
    }, 201)
  })
}

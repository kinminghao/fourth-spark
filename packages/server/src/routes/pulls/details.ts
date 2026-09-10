import type { Hono } from "hono"
import { eq, and, inArray } from "drizzle-orm"
import { db } from "../../db/index"
import { pullRequests, prIssueLinks, issues } from "../../db/schema"
import { parseBody } from "../../lib/validation"
import {
  LinkIssueBody,
  prId,
  rewriteAttachmentUrls,
  getRepoGitClient,
} from "./helpers"

export function registerDetailRoutes(app: Hono): void {
  // GET /:number/files — fetch PR changed files from platform
  app.get("/:number/files", async (c) => {
    const repoId = c.req.param("repoId")!
    const number = Number(c.req.param("number"))
    if (!Number.isFinite(number)) return c.json({ error: "invalid PR number" }, 400)

    const pid = prId(repoId, number)
    const [row] = await db.select({ diffStats: pullRequests.diffStats }).from(pullRequests).where(eq(pullRequests.id, pid))
    if (row?.diffStats) return c.json(row.diffStats)

    const ctx = await getRepoGitClient(repoId)
    if (!ctx) return c.json([])

    const files = await ctx.client.listPullRequestFiles(number)
    const diffStats = files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }))
    await db.update(pullRequests).set({ diffStats }).where(eq(pullRequests.id, pid))
    return c.json(diffStats)
  })

  // GET /:number/commits — fetch PR commits from platform
  app.get("/:number/commits", async (c) => {
    const repoId = c.req.param("repoId")!
    const number = Number(c.req.param("number"))
    if (!Number.isFinite(number)) return c.json({ error: "invalid PR number" }, 400)

    const ctx = await getRepoGitClient(repoId)
    if (!ctx) return c.json([])

    const commits = await ctx.client.listPullRequestCommits(number)
    return c.json(commits)
  })

  // GET /:number/comments — fetch PR comments from platform
  app.get("/:number/comments", async (c) => {
    const repoId = c.req.param("repoId")!
    const number = Number(c.req.param("number"))
    if (!Number.isFinite(number)) return c.json({ error: "invalid PR number" }, 400)

    const ctx = await getRepoGitClient(repoId)
    if (!ctx) return c.json([])

    const comments = await ctx.client.listComments(number)
    const rewritten = comments.map((cm) => ({ ...cm, body: rewriteAttachmentUrls(cm.body, repoId) ?? "" }))
    return c.json(rewritten)
  })

  app.get("/:number/issues", async (c) => {
    const repoId = c.req.param("repoId")!
    const number = Number(c.req.param("number"))
    if (!Number.isFinite(number)) return c.json({ error: "invalid PR number" }, 400)

    const pid = prId(repoId, number)
    const links = await db.select({ issueId: prIssueLinks.issueId })
      .from(prIssueLinks).where(eq(prIssueLinks.prId, pid))

    if (links.length === 0) return c.json([])

    const issueIds = links.map((l) => l.issueId)
    const rows = await db.select().from(issues).where(inArray(issues.id, issueIds))
    return c.json(rows)
  })

  app.post("/:number/issues", async (c) => {
    const repoId = c.req.param("repoId")!
    const number = Number(c.req.param("number"))
    if (!Number.isFinite(number)) return c.json({ error: "invalid PR number" }, 400)

    const [body, err] = await parseBody(c, LinkIssueBody)
    if (err) return err

    const pid = prId(repoId, number)
    const iid = `${repoId}_${body.issueNumber}`

    const [pr] = await db.select({ id: pullRequests.id }).from(pullRequests).where(eq(pullRequests.id, pid))
    const [issue] = await db.select({ id: issues.id }).from(issues).where(eq(issues.id, iid))
    if (!pr || !issue) return c.json({ error: "PR or issue not found" }, 404)

    await db.insert(prIssueLinks).values({ prId: pid, issueId: iid }).onConflictDoNothing()
    return c.json({ ok: true })
  })

  app.delete("/:number/issues/:issueNumber", async (c) => {
    const repoId = c.req.param("repoId")!
    const number = Number(c.req.param("number"))
    const issueNumber = Number(c.req.param("issueNumber"))
    if (!Number.isFinite(number) || !Number.isFinite(issueNumber))
      return c.json({ error: "invalid number" }, 400)

    const pid = prId(repoId, number)
    const iid = `${repoId}_${issueNumber}`

    await db.delete(prIssueLinks).where(and(eq(prIssueLinks.prId, pid), eq(prIssueLinks.issueId, iid)))
    return c.json({ ok: true })
  })
}

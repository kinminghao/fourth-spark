import { Hono } from "hono"
import { eq, and, desc } from "drizzle-orm"
import { db } from "../db/index"
import { issues, repos } from "../db/schema"
import { parseGitUrl } from "../lib/git-url"
import { createGitIssueClient, getHostInfo, type GitIssue } from "../lib/git-provider"
import { logger } from "../middleware/logger"

export const issueRoutes = new Hono()

function issueId(repoId: string, number: number): string {
  return `${repoId}_${number}`
}

function issueToDb(repoId: string, gi: GitIssue) {
  return {
    id: issueId(repoId, gi.number),
    repoId,
    number: gi.number,
    title: gi.title,
    body: gi.body || null,
    state: gi.state,
    labels: gi.labels?.map((l) => ({ id: l.id, name: l.name, color: l.color })) ?? [],
    htmlUrl: gi.html_url,
    createdAt: new Date(gi.created_at).getTime(),
    updatedAt: new Date(gi.updated_at).getTime(),
  }
}

async function getRepoGitClient(repoId: string) {
  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId))
  if (!repo) return null
  const remote = parseGitUrl(repo.gitUrl)
  if (!remote) return null
  const info = await getHostInfo(remote.host)
  if (!info) return null
  const client = createGitIssueClient(remote.host, remote.owner, remote.repo, info.token, info.platform)
  return { repo, remote, client, platform: info.platform }
}

issueRoutes.get("/", async (c) => {
  const repoId = c.req.param("repoId")!
  const state = c.req.query("state") ?? "open"
  const rows = state === "all"
    ? await db.select().from(issues).where(eq(issues.repoId, repoId)).orderBy(desc(issues.updatedAt))
    : await db.select().from(issues).where(and(eq(issues.repoId, repoId), eq(issues.state, state))).orderBy(desc(issues.updatedAt))
  return c.json(rows)
})

issueRoutes.post("/sync", async (c) => {
  const repoId = c.req.param("repoId")!
  const ctx = await getRepoGitClient(repoId)
  if (!ctx) return c.json({ error: "Repo not found or git host not configured" }, 400)

  const body = await c.req.json<{ state?: "open" | "closed" | "all" }>().catch(() => null)
  const state = body?.state ?? "all"

  let page = 1
  let total = 0
  const limit = 50
  while (true) {
    const batch = await ctx.client.listIssues({ state, page, limit })
    if (batch.length === 0) break
    for (const gi of batch) {
      const values = issueToDb(repoId, gi)
      const { id: _, createdAt: __, ...updateSet } = values
      await db.insert(issues).values(values).onConflictDoUpdate({ target: issues.id, set: updateSet })
    }
    total += batch.length
    if (batch.length < limit) break
    page++
  }

  logger.info({ repoId, total, state }, "issue sync complete")
  return c.json({ synced: total })
})

issueRoutes.post("/", async (c) => {
  const repoId = c.req.param("repoId")!
  const ctx = await getRepoGitClient(repoId)
  if (!ctx) return c.json({ error: "Repo not found or git host not configured" }, 400)

  const body = await c.req.json<{ title: string; body?: string }>().catch(() => null)
  if (!body?.title) return c.json({ error: "title is required" }, 400)

  const gi = await ctx.client.createIssue({ title: body.title, body: body.body })
  const values = issueToDb(repoId, gi)
  await db.insert(issues).values(values).onConflictDoNothing()

  return c.json(values, 201)
})

issueRoutes.patch("/:number", async (c) => {
  const repoId = c.req.param("repoId")!
  const number = Number(c.req.param("number"))
  if (!Number.isFinite(number)) return c.json({ error: "invalid issue number" }, 400)

  const ctx = await getRepoGitClient(repoId)
  if (!ctx) return c.json({ error: "Repo not found or git host not configured" }, 400)

  const body = await c.req.json<{ title?: string; body?: string; state?: "open" | "closed" }>().catch(() => null)
  if (!body) return c.json({ error: "empty body" }, 400)

  const gi = await ctx.client.updateIssue(number, body)
  const values = issueToDb(repoId, gi)
  const { id: _, createdAt: __, ...updateSet } = values
  await db.insert(issues).values(values).onConflictDoUpdate({ target: issues.id, set: updateSet })

  return c.json(values)
})

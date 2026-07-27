import { Hono } from "hono"
import { eq, and, desc, asc, inArray } from "drizzle-orm"
import { db } from "../db/index"
import { issues, issueComments, repos, tags, issueTags } from "../db/schema"
import { parseGitUrl } from "../lib/git-url"
import { createGitIssueClient, getHostInfo, GitApiError, type GitIssue, type GitComment } from "../lib/git-provider"
import { logger } from "../middleware/logger"

export const issueRoutes = new Hono()

function extractUpstreamMessage(raw: string): string {
  const jsonMatch = raw.match(/\{.*"message"\s*:\s*"([^"]+)"/)
  if (jsonMatch?.[1]) return jsonMatch[1]
  const arrow = raw.indexOf("→")
  return arrow >= 0 ? raw.slice(arrow + 1).trim() : raw
}

function rewriteAttachmentUrls(text: string | null | undefined, repoId: string): string | null {
  if (!text) return text ?? null
  const proxyBase = `/api/repos/${repoId}/issues/attachments`
  return text
    .replace(/src="\/?(attachments\/)/g, `src="${proxyBase}/`)
    .replace(/\]\(\/?(attachments\/)/g, `](${proxyBase}/`)
}

function issueId(repoId: string, number: number): string {
  return `${repoId}_${number}`
}

function commentToDb(repoId: string, issueNum: number, gc: GitComment) {
  return {
    id: `${repoId}_c${gc.id}`,
    issueId: issueId(repoId, issueNum),
    repoId,
    authorLogin: gc.user.login,
    authorAvatar: gc.user.avatar_url ?? null,
    body: gc.body,
    createdAt: new Date(gc.created_at).getTime(),
    updatedAt: new Date(gc.updated_at).getTime(),
  }
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
  const tagFilter = c.req.query("tags")

  let rows: (typeof issues.$inferSelect)[]

  if (tagFilter) {
    const tagNames = tagFilter.split(",").map((t) => t.trim()).filter(Boolean)
    if (tagNames.length > 0) {
      const matchedTags = await db.select({ id: tags.id }).from(tags)
        .where(and(eq(tags.repoId, repoId), inArray(tags.name, tagNames)))
      const tagIds = matchedTags.map((t) => t.id)

      if (tagIds.length === 0) return c.json([])

      const linked = await db.select({ issueId: issueTags.issueId }).from(issueTags)
        .where(inArray(issueTags.tagId, tagIds))
      const issueIdCounts = new Map<string, number>()
      for (const r of linked) {
        issueIdCounts.set(r.issueId, (issueIdCounts.get(r.issueId) ?? 0) + 1)
      }
      const matchedIssueIds = [...issueIdCounts.entries()]
        .filter(([, count]) => count >= tagIds.length)
        .map(([id]) => id)

      if (matchedIssueIds.length === 0) return c.json([])

      const conditions = [eq(issues.repoId, repoId), inArray(issues.id, matchedIssueIds)]
      if (state !== "all") conditions.push(eq(issues.state, state))
      rows = await db.select().from(issues).where(and(...conditions)).orderBy(desc(issues.updatedAt))
    } else {
      rows = state === "all"
        ? await db.select().from(issues).where(eq(issues.repoId, repoId)).orderBy(desc(issues.updatedAt))
        : await db.select().from(issues).where(and(eq(issues.repoId, repoId), eq(issues.state, state))).orderBy(desc(issues.updatedAt))
    }
  } else {
    rows = state === "all"
      ? await db.select().from(issues).where(eq(issues.repoId, repoId)).orderBy(desc(issues.updatedAt))
      : await db.select().from(issues).where(and(eq(issues.repoId, repoId), eq(issues.state, state))).orderBy(desc(issues.updatedAt))
  }

  for (const row of rows) {
    row.body = rewriteAttachmentUrls(row.body, repoId)
  }

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

  const allIssues = await db.select({ number: issues.number }).from(issues).where(eq(issues.repoId, repoId))
  let totalComments = 0
  for (const row of allIssues) {
    try {
      const comments = await ctx.client.listComments(row.number)
      for (const gc of comments) {
        const values = commentToDb(repoId, row.number, gc)
        const { id: _, createdAt: __, ...updateSet } = values
        await db.insert(issueComments).values(values).onConflictDoUpdate({ target: issueComments.id, set: updateSet })
      }
      totalComments += comments.length
    } catch (err) {
      logger.warn({ err, repoId, issueNumber: row.number }, "failed to sync comments for issue")
    }
  }

  let totalTags = 0
  const allDbIssues = await db.select({ id: issues.id, labels: issues.labels }).from(issues).where(eq(issues.repoId, repoId))
  const seenTags = new Map<string, string>()

  for (const row of allDbIssues) {
    if (!row.labels || row.labels.length === 0) continue
    for (const label of row.labels) {
      if (seenTags.has(label.name)) continue
      const tid = `${repoId}_tag_${label.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`
      await db.insert(tags).values({
        id: tid,
        repoId,
        name: label.name,
        color: label.color || "6b7280",
        description: null,
        createdAt: Date.now(),
      }).onConflictDoNothing()
      seenTags.set(label.name, tid)
      totalTags++
    }

    const tagIds = row.labels.map((l) => seenTags.get(l.name)!).filter(Boolean)
    if (tagIds.length > 0) {
      await db.delete(issueTags).where(eq(issueTags.issueId, row.id))
      await db.insert(issueTags).values(tagIds.map((tid) => ({ issueId: row.id, tagId: tid }))).onConflictDoNothing()
    }
  }

  logger.info({ repoId, total, totalComments, totalTags, state }, "issue sync complete")
  return c.json({ synced: total, comments: totalComments, tags: totalTags })
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

issueRoutes.post("/:number/children", async (c) => {
  const repoId = c.req.param("repoId")!
  const parentNumber = Number(c.req.param("number"))
  if (!Number.isFinite(parentNumber)) return c.json({ error: "invalid issue number" }, 400)

  const body = await c.req.json<{ childNumber?: number }>().catch(() => null)
  if (!body?.childNumber) return c.json({ error: "childNumber is required" }, 400)

  const parentId = issueId(repoId, parentNumber)
  const childId = issueId(repoId, body.childNumber)

  const [parent] = await db.select().from(issues).where(eq(issues.id, parentId))
  const [child] = await db.select().from(issues).where(eq(issues.id, childId))
  if (!parent || !child) return c.json({ error: "parent or child issue not found in DB" }, 404)

  await db.update(issues).set({ parentId }).where(eq(issues.id, childId))

  const ctx = await getRepoGitClient(repoId)
  if (ctx) {
    try {
      await ctx.client.addDependency(parentNumber, body.childNumber)
    } catch (err) {
      logger.warn({ err, parentNumber, childNumber: body.childNumber }, "failed to add dependency on git host")
    }
    try {
      await ctx.client.createComment(body.childNumber, `已关联为 #${parentNumber} 的子任务`)
    } catch (err) {
      logger.warn({ err, childNumber: body.childNumber }, "failed to create comment on git host")
    }
  }

  return c.json({ ok: true, parentId, childId })
})

issueRoutes.get("/:number/comments", async (c) => {
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

issueRoutes.get("/attachments/:uuid", async (c) => {
  const repoId = c.req.param("repoId")!
  const uuid = c.req.param("uuid")!

  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId))
  if (!repo) return c.json({ error: "repo not found" }, 404)
  const remote = parseGitUrl(repo.gitUrl)
  if (!remote) return c.json({ error: "invalid git url" }, 400)
  const info = await getHostInfo(remote.host)
  if (!info) return c.json({ error: "git host not configured" }, 400)

  const upstream = await fetch(`https://${remote.host}/attachments/${uuid}`, {
    headers: { Authorization: `token ${info.token}` },
  })
  if (!upstream.ok) return c.body(null, upstream.status as 404)

  const headers = new Headers()
  for (const key of ["content-type", "content-length", "cache-control", "etag", "last-modified"]) {
    const val = upstream.headers.get(key)
    if (val) headers.set(key, val)
  }

  return new Response(upstream.body, { status: 200, headers })
})

issueRoutes.get("/:number/pulls", async (c) => {
  const repoId = c.req.param("repoId")!
  const number = Number(c.req.param("number"))
  if (!Number.isFinite(number)) return c.json({ error: "invalid issue number" }, 400)

  const ctx = await getRepoGitClient(repoId)
  if (!ctx) return c.json([])

  const prs = await ctx.client.listIssuePullRequests(number)
  for (const pr of prs) {
    pr.body = rewriteAttachmentUrls(pr.body, repoId) ?? ""
  }
  return c.json(prs)
})

issueRoutes.post("/:number/pulls/:prNumber/merge", async (c) => {
  const repoId = c.req.param("repoId")!
  const number = Number(c.req.param("number"))
  const prNumber = Number(c.req.param("prNumber"))
  if (!Number.isFinite(number) || !Number.isFinite(prNumber))
    return c.json({ error: "invalid number" }, 400)

  const ctx = await getRepoGitClient(repoId)
  if (!ctx) return c.json({ error: "Repo not found or git host not configured" }, 400)

  try {
    await ctx.client.mergePullRequest(prNumber)
  } catch (err) {
    if (err instanceof GitApiError) {
      const msg = err.message
      const isConflict = msg.includes("merge conflict") || msg.includes("not mergeable") || err.status === 405 || err.status === 409
      const status = isConflict ? 409 : err.status >= 400 && err.status < 600 ? err.status : 500
      const userMessage = isConflict
        ? "PR 存在合并冲突，请先解决冲突后再合入"
        : `合入失败: ${extractUpstreamMessage(msg)}`
      return c.json({ error: userMessage, code: isConflict ? "MERGE_CONFLICT" : "MERGE_FAILED" }, status as 409)
    }
    return c.json({ error: "合入失败: 未知错误" }, 500)
  }

  const body = await c.req.json<{ closeIssue?: boolean }>().catch(() => null)
  if (body?.closeIssue) {
    const gi = await ctx.client.updateIssue(number, { state: "closed" })
    const values = issueToDb(repoId, gi)
    const { id: _, createdAt: __, ...updateSet } = values
    await db.insert(issues).values(values).onConflictDoUpdate({ target: issues.id, set: updateSet })
  }

  return c.json({ ok: true })
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

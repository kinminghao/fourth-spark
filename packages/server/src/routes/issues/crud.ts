import { Hono } from "hono"
import { eq, and, desc, inArray, count } from "drizzle-orm"
import { db } from "../../db/index"
import { issues, issueComments, repos, tags, issueTags, milestones } from "../../db/schema"
import { parsePagination, paginatedResponse } from "../../lib/pagination"
import { parseGitUrl } from "../../lib/git-url"
import { createGitIssueClient, getHostInfo, GitApiError, type GitComment } from "../../lib/git-provider"
import { logger } from "../../middleware/logger"
import { parseBody, parseOptionalBody } from "../../lib/validation"
import {
  SyncIssuesBody,
  CreateIssueBody,
  AddChildBody,
  MergeCloseBody,
  UpdateIssueBody,
  extractUpstreamMessage,
  rewriteAttachmentUrls,
  issueId,
  commentToDb,
  issueToDb,
  getRepoGitClient,
} from "./helpers"

export function registerCrudRoutes(app: Hono): void {
  app.get("/", async (c) => {
    const repoId = c.req.param("repoId")!
    const state = c.req.query("state") ?? "open"
    const tagFilter = c.req.query("tags")
    const milestoneFilter = c.req.query("milestone")
    const pg = parsePagination({ limit: c.req.query("limit"), offset: c.req.query("offset") })

    // Build WHERE conditions shared by both count and data queries
    let where: ReturnType<typeof and>

    if (tagFilter) {
      const tagNames = tagFilter.split(",").map((t) => t.trim()).filter(Boolean)
      if (tagNames.length > 0) {
        const matchedTags = await db.select({ id: tags.id }).from(tags)
          .where(and(eq(tags.repoId, repoId), inArray(tags.name, tagNames)))
        const tagIds = matchedTags.map((t) => t.id)

        if (tagIds.length === 0) return c.json(paginatedResponse([], 0, pg))

        const linked = await db.select({ issueId: issueTags.issueId }).from(issueTags)
          .where(inArray(issueTags.tagId, tagIds))
        const issueIdCounts = new Map<string, number>()
        for (const r of linked) {
          issueIdCounts.set(r.issueId, (issueIdCounts.get(r.issueId) ?? 0) + 1)
        }
        const matchedIssueIds = [...issueIdCounts.entries()]
          .filter(([, cnt]) => cnt >= tagIds.length)
          .map(([id]) => id)

        if (matchedIssueIds.length === 0) return c.json(paginatedResponse([], 0, pg))

        const conditions = [eq(issues.repoId, repoId), inArray(issues.id, matchedIssueIds)]
        if (state !== "all") conditions.push(eq(issues.state, state))
        if (milestoneFilter) conditions.push(eq(issues.milestoneId, milestoneFilter))
        where = and(...conditions)
      } else {
        const conditions = [eq(issues.repoId, repoId)]
        if (state !== "all") conditions.push(eq(issues.state, state))
        if (milestoneFilter) conditions.push(eq(issues.milestoneId, milestoneFilter))
        where = and(...conditions)
      }
    } else {
      const conditions = [eq(issues.repoId, repoId)]
      if (state !== "all") conditions.push(eq(issues.state, state))
      if (milestoneFilter) conditions.push(eq(issues.milestoneId, milestoneFilter))
      where = and(...conditions)
    }

    const [{ total }] = await db.select({ total: count() }).from(issues).where(where)
    const rows = await db.select().from(issues)
      .where(where)
      .orderBy(desc(issues.updatedAt))
      .limit(pg.limit)
      .offset(pg.offset)

    for (const row of rows) {
      row.body = rewriteAttachmentUrls(row.body, repoId)
    }

    return c.json(paginatedResponse(rows, total, pg))
  })

  app.post("/sync", async (c) => {
    const repoId = c.req.param("repoId")!

    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId))
    if (!repo) return c.json({ error: "仓库不存在" }, 404)
    const remote = parseGitUrl(repo.gitUrl)
    if (!remote) return c.json({ error: "仓库的 Git URL 格式无效" }, 400)
    const info = await getHostInfo(remote.host)
    if (!info) return c.json({ error: `未配置 ${remote.host} 的访问令牌，请在设置中添加对应的 Git Host` }, 400)

    const client = createGitIssueClient(remote.host, remote.owner, remote.repo, info.token, info.platform)

    const [body, err] = await parseOptionalBody(c, SyncIssuesBody)
    if (err) return err
    const state = body.state ?? "all"

    // Must run before issue sync: issues.milestone_id FKs milestones.id, so milestone rows must exist first.
    let totalMilestones = 0
    try {
      const gitMilestones = await client.listMilestones({ state: "all" })
      for (const gm of gitMilestones) {
        const msId = `${repoId}_ms_${gm.id}`
        const values = {
          id: msId,
          repoId,
          number: gm.number ?? gm.id,
          title: gm.title,
          description: gm.description || null,
          state: gm.state,
          dueOn: gm.due_on ? new Date(gm.due_on).getTime() : null,
          openIssues: gm.open_issues ?? 0,
          closedIssues: gm.closed_issues ?? 0,
          createdAt: new Date(gm.created_at).getTime(),
          updatedAt: new Date(gm.updated_at).getTime(),
        }
        const { id: _, createdAt: __, ...updateSet } = values
        await db.insert(milestones).values(values).onConflictDoUpdate({ target: milestones.id, set: updateSet })
        totalMilestones++
      }
    } catch (err) {
      logger.warn({ err, repoId }, "failed to sync milestones from git host")
    }

    let page = 1
    let total = 0
    const limit = 50
    try {
      while (true) {
        const batch = await client.listIssues({ state, page, limit })
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
    } catch (err) {
      logger.error({ err, repoId, state, page }, "failed to sync issues from git host")
      const status = (err as { status?: number }).status
      if (status === 401 || status === 403) {
        return c.json({ error: `Git 平台认证失败 (${status})，请检查访问令牌是否有效` }, 400)
      }
      return c.json({ error: "从 Git 平台拉取 Issue 失败，请稍后重试" }, 502)
    }

    const allIssues = await db.select({ number: issues.number }).from(issues).where(eq(issues.repoId, repoId))
    let totalComments = 0

    const CONCURRENCY = 5
    const COMMENT_SYNC_TIMEOUT_MS = 120_000
    let active = 0
    const queue = [...allIssues]
    const results: Array<{ issueNum: number; comments: GitComment[] }> = []

    const commentSync = new Promise<void>((resolve) => {
      if (queue.length === 0) return resolve()
      let finished = 0
      const total = queue.length

      function next() {
        while (active < CONCURRENCY && queue.length > 0) {
          const row = queue.shift()!
          active++
          client.listComments(row.number)
            .then((comments) => { results.push({ issueNum: row.number, comments }) })
            .catch((err) => { logger.warn({ err, repoId, issueNumber: row.number }, "failed to sync comments for issue") })
            .finally(() => {
              active--
              finished++
              if (finished === total) resolve()
              else next()
            })
        }
      }
      next()
    })

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`comment sync timed out after ${COMMENT_SYNC_TIMEOUT_MS / 1000}s`)), COMMENT_SYNC_TIMEOUT_MS),
    )

    try {
      await Promise.race([commentSync, timeout])
    } catch (err) {
      logger.error({ err, repoId, fetched: results.length, total: allIssues.length }, "comment sync aborted")
    }

    for (const { issueNum, comments } of results) {
      if (comments.length === 0) continue
      const rows = comments.map((gc) => commentToDb(repoId, issueNum, gc))
      for (const values of rows) {
        const { id: _, createdAt: __, ...updateSet } = values
        await db.insert(issueComments).values(values).onConflictDoUpdate({ target: issueComments.id, set: updateSet })
      }
      totalComments += comments.length
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

    logger.info({ repoId, total, totalComments, totalTags, totalMilestones, state }, "issue sync complete")
    return c.json({ synced: total, comments: totalComments, tags: totalTags, milestones: totalMilestones })
  })

  app.post("/", async (c) => {
    const repoId = c.req.param("repoId")!
    const ctx = await getRepoGitClient(repoId)
    if (!ctx) return c.json({ error: "Repo not found or git host not configured" }, 400)

    const [body, err] = await parseBody(c, CreateIssueBody)
    if (err) return err

    const gi = await ctx.client.createIssue({ title: body.title, body: body.body })
    const values = issueToDb(repoId, gi)
    await db.insert(issues).values(values).onConflictDoNothing()

    return c.json(values, 201)
  })

  app.post("/:number/children", async (c) => {
    const repoId = c.req.param("repoId")!
    const parentNumber = Number(c.req.param("number"))
    if (!Number.isFinite(parentNumber)) return c.json({ error: "invalid issue number" }, 400)

    const [body, err] = await parseBody(c, AddChildBody)
    if (err) return err

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

    return c.json({ parentId, childId })
  })

  app.get("/attachments/:uuid", async (c) => {
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

  app.get("/:number/pulls", async (c) => {
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

  app.post("/:number/pulls/:prNumber/merge", async (c) => {
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

    const [body, err] = await parseOptionalBody(c, MergeCloseBody)
    if (err) return err
    if (body.closeIssue) {
      const gi = await ctx.client.updateIssue(number, { state: "closed" })
      const values = issueToDb(repoId, gi)
      const { id: _, createdAt: __, ...updateSet } = values
      await db.insert(issues).values(values).onConflictDoUpdate({ target: issues.id, set: updateSet })
    }

    return c.json({ ok: true })
  })

  app.patch("/:number", async (c) => {
    const repoId = c.req.param("repoId")!
    const number = Number(c.req.param("number"))
    if (!Number.isFinite(number)) return c.json({ error: "invalid issue number" }, 400)

    const ctx = await getRepoGitClient(repoId)
    if (!ctx) return c.json({ error: "Repo not found or git host not configured" }, 400)

    const [body, err] = await parseBody(c, UpdateIssueBody)
    if (err) return err

    const gi = await ctx.client.updateIssue(number, body)
    const values = issueToDb(repoId, gi)
    const { id: _, createdAt: __, ...updateSet } = values
    await db.insert(issues).values(values).onConflictDoUpdate({ target: issues.id, set: updateSet })

    return c.json(values)
  })
}

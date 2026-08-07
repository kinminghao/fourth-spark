import { Hono } from "hono"
import { eq, and, desc, asc, inArray } from "drizzle-orm"
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises"
import { existsSync } from "node:fs"
import { db } from "../db/index"
import { issues, issueComments, repos, tags, issueTags, milestones, sessions as sessionsTable, customAgents, workspaces } from "../db/schema"
import { parseGitUrl } from "../lib/git-url"
import { createGitIssueClient, getHostInfo, GitApiError, type GitIssue, type GitComment } from "../lib/git-provider"
import { processManager } from "../lib/process-manager"
import { workspaceManager } from "../lib/workspace-manager"
import { createOpenCodeClient } from "../lib/opencode"
import { DEFAULT_VARIANT } from "../lib/config"
import { COMMENT_POLISHER_ID } from "../lib/system-agents"
import { buildIssueContext } from "./sessions"
import { logger } from "../middleware/logger"

const DRAFT_DIR = "/tmp/fourth-spark/drafts"

function draftPath(repoId: string, issueNumber: number): string {
  return `${DRAFT_DIR}/${repoId}-${issueNumber}.md`
}

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
    milestoneId: gi.milestone ? `${repoId}_ms_${gi.milestone.id}` : null,
    authorLogin: gi.user?.login ?? null,
    authorAvatar: gi.user?.avatar_url ?? null,
    assignees: gi.assignees?.map((a) => ({ login: a.login, avatar_url: a.avatar_url })) ?? [],
    commentCount: gi.comments ?? 0,
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
  const milestoneFilter = c.req.query("milestone")

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
      if (milestoneFilter) conditions.push(eq(issues.milestoneId, milestoneFilter))
      rows = await db.select().from(issues).where(and(...conditions)).orderBy(desc(issues.updatedAt))
    } else {
      const conditions = [eq(issues.repoId, repoId)]
      if (state !== "all") conditions.push(eq(issues.state, state))
      if (milestoneFilter) conditions.push(eq(issues.milestoneId, milestoneFilter))
      rows = await db.select().from(issues).where(and(...conditions)).orderBy(desc(issues.updatedAt))
    }
  } else {
    const conditions = [eq(issues.repoId, repoId)]
    if (state !== "all") conditions.push(eq(issues.state, state))
    if (milestoneFilter) conditions.push(eq(issues.milestoneId, milestoneFilter))
    rows = await db.select().from(issues).where(and(...conditions)).orderBy(desc(issues.updatedAt))
  }

  for (const row of rows) {
    row.body = rewriteAttachmentUrls(row.body, repoId)
  }

  return c.json(rows)
})

issueRoutes.post("/sync", async (c) => {
  const repoId = c.req.param("repoId")!

  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId))
  if (!repo) return c.json({ error: "仓库不存在" }, 404)
  const remote = parseGitUrl(repo.gitUrl)
  if (!remote) return c.json({ error: "仓库的 Git URL 格式无效" }, 400)
  const info = await getHostInfo(remote.host)
  if (!info) return c.json({ error: `未配置 ${remote.host} 的访问令牌，请在设置中添加对应的 Git Host` }, 400)

  const client = createGitIssueClient(remote.host, remote.owner, remote.repo, info.token, info.platform)

  const body = await c.req.json<{ state?: "open" | "closed" | "all" }>().catch(() => null)
  const state = body?.state ?? "all"

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
  for (const row of allIssues) {
    try {
      const comments = await client.listComments(row.number)
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

  logger.info({ repoId, total, totalComments, totalTags, totalMilestones, state }, "issue sync complete")
  return c.json({ synced: total, comments: totalComments, tags: totalTags, milestones: totalMilestones })
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

// ---------------------------------------------------------------------------
// AI 评论润色 — 写草稿到临时文件，起 session 让 Agent 润色
// ---------------------------------------------------------------------------

issueRoutes.post("/:number/polish", async (c) => {
  const repoId = c.req.param("repoId")!
  const number = Number(c.req.param("number"))
  if (!Number.isFinite(number)) return c.json({ error: "invalid issue number" }, 400)

  const body = await c.req.json<{ draft: string }>().catch(() => null)
  if (!body?.draft?.trim()) return c.json({ error: "draft is required" }, 400)

  const repoClient = processManager.requireClient(repoId)
  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId))
  if (!repo) return c.json({ error: "Repo not found" }, 404)

  await mkdir(DRAFT_DIR, { recursive: true })
  const filePath = draftPath(repoId, number)
  await writeFile(filePath, body.draft, "utf-8")

  const [agent] = await db.select().from(customAgents).where(eq(customAgents.id, COMMENT_POLISHER_ID))
  if (!agent) return c.json({ error: "系统评论助手 Agent 未初始化" }, 500)

  const iid = issueId(repoId, number)
  const parts: string[] = []
  if (agent.systemPrompt) parts.push(agent.systemPrompt)

  const issueContext = await buildIssueContext(iid)
  if (issueContext) parts.push(issueContext)

  parts.push(`请润色以下文件中的评论草稿内容: ${filePath}`)

  const prompt = parts.join("\n\n---\n\n")

  let client = repoClient
  let workspaceId: string | null = null

  if (repo.worktreeEnabled) {
    const workspace = await workspaceManager.create(repoId, repo.localPath)
    workspaceId = workspace.id
    client = createOpenCodeClient(repoClient.baseUrl, workspace.localPath)
  }

  const session = await client.createSession({ agent: agent.baseAgent })
  const now = Date.now()
  await db.insert(sessionsTable).values({
    id: session.id,
    title: `润色评论 #${number}`,
    workspaceId,
    issueId: iid,
    customAgentId: COMMENT_POLISHER_ID,
    agent: agent.baseAgent,
    timeCreated: now,
    timeUpdated: now,
  }).onConflictDoUpdate({
    target: sessionsTable.id,
    set: { workspaceId, issueId: iid, customAgentId: COMMENT_POLISHER_ID, timeUpdated: now },
  })

  try {
    await client.prompt(session.id, prompt, { agent: agent.baseAgent, model: agent.model ?? undefined, variant: DEFAULT_VARIANT })
  } catch (err) {
    logger.error({ err, sessionId: session.id }, "polish prompt failed, cleaning up")
    await client.deleteSession(session.id).catch(() => {})
    await db.delete(sessionsTable).where(eq(sessionsTable.id, session.id)).catch(() => {})
    if (workspaceId) await workspaceManager.remove(workspaceId).catch(() => {})
    throw err
  }

  return c.json({ sessionId: session.id, draftPath: filePath, workspaceId }, 201)
})

// ---------------------------------------------------------------------------
// 读取润色后的草稿文件
// ---------------------------------------------------------------------------

issueRoutes.get("/:number/draft", async (c) => {
  const repoId = c.req.param("repoId")!
  const number = Number(c.req.param("number"))
  if (!Number.isFinite(number)) return c.json({ error: "invalid issue number" }, 400)

  const filePath = draftPath(repoId, number)
  if (!existsSync(filePath)) return c.json({ error: "no draft found" }, 404)

  const content = await readFile(filePath, "utf-8")
  return c.json({ body: content })
})

// ---------------------------------------------------------------------------
// 发布评论 — 调 git provider + 存 DB + 删临时文件
// ---------------------------------------------------------------------------

issueRoutes.post("/:number/comments", async (c) => {
  const repoId = c.req.param("repoId")!
  const number = Number(c.req.param("number"))
  if (!Number.isFinite(number)) return c.json({ error: "invalid issue number" }, 400)

  const body = await c.req.json<{ body: string }>().catch(() => null)
  if (!body?.body?.trim()) return c.json({ error: "comment body is required" }, 400)

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

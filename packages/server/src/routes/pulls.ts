import { Hono } from "hono"
import { eq, and, desc, inArray } from "drizzle-orm"
import { db } from "../db/index"
import { pullRequests, prIssueLinks, issues, repos } from "../db/schema"
import { parseGitUrl } from "../lib/git-url"
import { createGitIssueClient, getHostInfo, GitApiError, type GitPullRequest } from "../lib/git-provider"
import { logger } from "../middleware/logger"

export const pullRoutes = new Hono()

function prId(repoId: string, number: number): string {
  return `${repoId}_pr_${number}`
}

function rewriteAttachmentUrls(text: string | null | undefined, repoId: string): string | null {
  if (!text) return text ?? null
  const proxyBase = `/api/repos/${repoId}/issues/attachments`
  return text
    .replace(/src="\/?(attachments\/)/g, `src="${proxyBase}/`)
    .replace(/\]\(\/?(attachments\/)/g, `](${proxyBase}/`)
}

function extractUpstreamMessage(raw: string): string {
  const jsonMatch = raw.match(/\{.*"message"\s*:\s*"([^"]+)"/)
  if (jsonMatch?.[1]) return jsonMatch[1]
  const arrow = raw.indexOf("→")
  return arrow >= 0 ? raw.slice(arrow + 1).trim() : raw
}

function prToDb(repoId: string, gpr: GitPullRequest) {
  return {
    id: prId(repoId, gpr.number),
    repoId,
    number: gpr.number,
    title: gpr.title,
    body: gpr.body || null,
    state: gpr.merged_at ? "merged" : gpr.state,
    headBranch: gpr.head?.ref ?? "",
    baseBranch: gpr.base?.ref ?? "",
    labels: gpr.labels?.map((l) => ({ id: l.id, name: l.name, color: l.color })) ?? [],
    htmlUrl: gpr.html_url,
    authorLogin: gpr.user?.login ?? null,
    authorAvatar: gpr.user?.avatar_url ?? null,
    assignees: gpr.assignees?.map((a) => ({ login: a.login, avatar_url: a.avatar_url })) ?? [],
    mergeable: gpr.mergeable === true ? "true" : gpr.mergeable === false ? "false" : null,
    draft: gpr.draft ? 1 : 0,
    commentCount: gpr.comments ?? 0,
    additions: gpr.additions ?? null,
    deletions: gpr.deletions ?? null,
    changedFilesCount: gpr.changed_files ?? null,
    commitCount: gpr.commits ?? null,
    createdAt: new Date(gpr.created_at).getTime(),
    updatedAt: new Date(gpr.updated_at).getTime(),
    mergedAt: gpr.merged_at ? new Date(gpr.merged_at).getTime() : null,
  }
}

function parseIssueRefs(body: string | null | undefined): number[] {
  if (!body) return []
  const nums = new Set<number>()
  const keyword = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|ref)\s+#(\d+)/gi
  let m: RegExpExecArray | null
  while ((m = keyword.exec(body)) !== null) nums.add(Number(m[1]))
  const bare = /(?:^|[\s,;(])#(\d+)\b/gm
  while ((m = bare.exec(body)) !== null) nums.add(Number(m[1]))
  return [...nums]
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

// GET / — list pull requests from DB
pullRoutes.get("/", async (c) => {
  const repoId = c.req.param("repoId")!
  const state = c.req.query("state") ?? "open"

  const conditions = [eq(pullRequests.repoId, repoId)]
  if (state !== "all") conditions.push(eq(pullRequests.state, state))

  const rows = await db.select().from(pullRequests)
    .where(and(...conditions))
    .orderBy(desc(pullRequests.updatedAt))

  for (const row of rows) {
    row.body = rewriteAttachmentUrls(row.body, repoId)
  }

  return c.json(rows)
})

// POST /sync — sync PRs from git platform to DB
pullRoutes.post("/sync", async (c) => {
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

  let page = 1
  let total = 0
  const limit = 50
  try {
    // For "all" state, we need to fetch open and closed separately (most git APIs don't support "all" for PRs)
    const states: Array<"open" | "closed"> = state === "all" ? ["open", "closed"] : [state as "open" | "closed"]

    for (const s of states) {
      page = 1
      while (true) {
        const batch = await client.listPullRequests({ state: s, page, limit })
        if (batch.length === 0) break
        for (const gpr of batch) {
          let detail = gpr
          let diffStats: Array<{ filename: string; status: string; additions: number; deletions: number }> | null = null
          try {
            detail = await client.getPullRequest(gpr.number)
            const files = await client.listPullRequestFiles(gpr.number)
            diffStats = files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }))
          } catch (detailErr) {
            logger.warn({ err: detailErr, repoId, prNumber: gpr.number }, "failed to fetch PR detail/files, using list data")
          }
          const values = { ...prToDb(repoId, detail), diffStats }
          const { id: _, createdAt: __, ...updateSet } = values
          await db.insert(pullRequests).values(values).onConflictDoUpdate({ target: pullRequests.id, set: updateSet })
        }
        total += batch.length
        if (batch.length < limit) break
        page++
      }
    }
  } catch (err) {
    logger.error({ err, repoId, state, page }, "failed to sync PRs from git host")
    const status = (err as { status?: number }).status
    if (status === 401 || status === 403) {
      return c.json({ error: `Git 平台认证失败 (${status})，请检查访问令牌是否有效` }, 400)
    }
    return c.json({ error: "从 Git 平台拉取 PR 失败，请稍后重试" }, 502)
  }

  let totalLinks = 0
  const allPrs = await db.select({ id: pullRequests.id, number: pullRequests.number, body: pullRequests.body })
    .from(pullRequests).where(eq(pullRequests.repoId, repoId))
  for (const row of allPrs) {
    const refs = parseIssueRefs(row.body)
    for (const issueNum of refs) {
      const iid = `${repoId}_${issueNum}`
      const [exists] = await db.select({ id: issues.id }).from(issues).where(eq(issues.id, iid))
      if (!exists) continue
      await db.insert(prIssueLinks).values({ prId: row.id, issueId: iid }).onConflictDoNothing()
      totalLinks++
    }
  }

  logger.info({ repoId, total, totalLinks, state }, "PR sync complete")
  return c.json({ synced: total, links: totalLinks })
})

// GET /:number — get single PR from DB (fallback to platform)
pullRoutes.get("/:number", async (c) => {
  const repoId = c.req.param("repoId")!
  const number = Number(c.req.param("number"))
  if (!Number.isFinite(number)) return c.json({ error: "invalid PR number" }, 400)

  const pid = prId(repoId, number)
  const [row] = await db.select().from(pullRequests).where(eq(pullRequests.id, pid))

  if (row) {
    if (row.additions === null || row.diffStats === null) {
      const ctx = await getRepoGitClient(repoId)
      if (ctx) {
        try {
          const detail = await ctx.client.getPullRequest(number)
          const files = await ctx.client.listPullRequestFiles(number)
          const diffStats = files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }))
          const statsUpdate = {
            additions: detail.additions ?? 0,
            deletions: detail.deletions ?? 0,
            changedFilesCount: detail.changed_files ?? 0,
            commitCount: detail.commits ?? 0,
            diffStats,
          }
          await db.update(pullRequests).set(statsUpdate).where(eq(pullRequests.id, pid))
          Object.assign(row, statsUpdate)
        } catch (err) {
          logger.warn({ err, repoId, prNumber: number }, "failed to fetch PR diff stats on demand")
        }
      }
    }
    row.body = rewriteAttachmentUrls(row.body, repoId)
    return c.json(row)
  }

  // Fallback: fetch from platform
  const ctx = await getRepoGitClient(repoId)
  if (!ctx) return c.json({ error: "Repo not found or git host not configured" }, 400)

  const gpr = await ctx.client.getPullRequest(number)
  const files = await ctx.client.listPullRequestFiles(number).catch(() => [])
  const diffStats = files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }))
  const values = { ...prToDb(repoId, gpr), diffStats }
  await db.insert(pullRequests).values(values).onConflictDoNothing()
  values.body = rewriteAttachmentUrls(values.body, repoId)
  return c.json(values)
})

// GET /:number/files — fetch PR changed files from platform
pullRoutes.get("/:number/files", async (c) => {
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
pullRoutes.get("/:number/commits", async (c) => {
  const repoId = c.req.param("repoId")!
  const number = Number(c.req.param("number"))
  if (!Number.isFinite(number)) return c.json({ error: "invalid PR number" }, 400)

  const ctx = await getRepoGitClient(repoId)
  if (!ctx) return c.json([])

  const commits = await ctx.client.listPullRequestCommits(number)
  return c.json(commits)
})

// GET /:number/comments — fetch PR comments from platform
pullRoutes.get("/:number/comments", async (c) => {
  const repoId = c.req.param("repoId")!
  const number = Number(c.req.param("number"))
  if (!Number.isFinite(number)) return c.json({ error: "invalid PR number" }, 400)

  const ctx = await getRepoGitClient(repoId)
  if (!ctx) return c.json([])

  const comments = await ctx.client.listComments(number)
  const rewritten = comments.map((cm) => ({ ...cm, body: rewriteAttachmentUrls(cm.body, repoId) ?? "" }))
  return c.json(rewritten)
})

// POST /:number/merge — merge a PR
pullRoutes.post("/:number/merge", async (c) => {
  const repoId = c.req.param("repoId")!
  const number = Number(c.req.param("number"))
  if (!Number.isFinite(number)) return c.json({ error: "invalid PR number" }, 400)

  const ctx = await getRepoGitClient(repoId)
  if (!ctx) return c.json({ error: "Repo not found or git host not configured" }, 400)

  try {
    await ctx.client.mergePullRequest(number)
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

  // Refresh PR state in DB after merge
  try {
    const gpr = await ctx.client.getPullRequest(number)
    const values = prToDb(repoId, gpr)
    const { id: _, createdAt: __, ...updateSet } = values
    await db.insert(pullRequests).values(values).onConflictDoUpdate({ target: pullRequests.id, set: updateSet })
  } catch (err) {
    logger.warn({ err, repoId, prNumber: number }, "failed to refresh PR after merge")
  }

  return c.json({ ok: true })
})

pullRoutes.get("/:number/issues", async (c) => {
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

pullRoutes.post("/:number/issues", async (c) => {
  const repoId = c.req.param("repoId")!
  const number = Number(c.req.param("number"))
  if (!Number.isFinite(number)) return c.json({ error: "invalid PR number" }, 400)

  const body = await c.req.json<{ issueNumber: number }>().catch(() => null)
  if (!body?.issueNumber) return c.json({ error: "issueNumber is required" }, 400)

  const pid = prId(repoId, number)
  const iid = `${repoId}_${body.issueNumber}`

  const [pr] = await db.select({ id: pullRequests.id }).from(pullRequests).where(eq(pullRequests.id, pid))
  const [issue] = await db.select({ id: issues.id }).from(issues).where(eq(issues.id, iid))
  if (!pr || !issue) return c.json({ error: "PR or issue not found" }, 404)

  await db.insert(prIssueLinks).values({ prId: pid, issueId: iid }).onConflictDoNothing()
  return c.json({ ok: true })
})

pullRoutes.delete("/:number/issues/:issueNumber", async (c) => {
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

import { db } from "../db/index"
import { repos, issues, issueComments, milestones, tags, issueTags, pullRequests, prIssueLinks } from "../db/schema"
import { eq } from "drizzle-orm"
import { parseGitUrl } from "./git-url"
import { createGitIssueClient, getHostInfo, type GitComment, type GitPullRequest } from "./git-provider"
import { logger } from "../middleware/logger"

const SYNC_INTERVAL_MS = 60 * 60 * 1000
const REPO_CONCURRENCY = 3

let timer: ReturnType<typeof setInterval> | null = null

function issueId(repoId: string, number: number): string {
  return `${repoId}_${number}`
}

function prId(repoId: string, number: number): string {
  return `${repoId}_pr_${number}`
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

async function syncRepo(repoId: string, gitUrl: string): Promise<void> {
  const remote = parseGitUrl(gitUrl)
  if (!remote) return
  const info = await getHostInfo(remote.host)
  if (!info) return

  const client = createGitIssueClient(remote.host, remote.owner, remote.repo, info.token, info.platform)

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
    }
  } catch (err) {
    logger.warn({ err, repoId }, "[sync-scheduler] failed to sync milestones")
  }

  let totalIssues = 0
  try {
    let page = 1
    const limit = 50
    while (true) {
      const batch = await client.listIssues({ state: "all", page, limit })
      if (batch.length === 0) break
      for (const gi of batch) {
        const values = {
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
        const { id: _id, createdAt: _ca, ...updateSet } = values
        await db.insert(issues).values(values).onConflictDoUpdate({ target: issues.id, set: updateSet })
      }
      totalIssues += batch.length
      if (batch.length < limit) break
      page++
    }
  } catch (err) {
    logger.warn({ err, repoId }, "[sync-scheduler] failed to sync issues")
  }

  const allIssues = await db.select({ number: issues.number }).from(issues).where(eq(issues.repoId, repoId))
  let totalComments = 0
  const CONCURRENCY = 5
  let active = 0
  const commentQueue = [...allIssues]
  const commentResults: Array<{ issueNum: number; comments: GitComment[] }> = []

  await new Promise<void>((resolve) => {
    if (commentQueue.length === 0) return resolve()
    let finished = 0
    const count = commentQueue.length

    function next() {
      while (active < CONCURRENCY && commentQueue.length > 0) {
        const row = commentQueue.shift()!
        active++
        client.listComments(row.number)
          .then((comments) => { commentResults.push({ issueNum: row.number, comments }) })
          .catch((err) => { logger.warn({ err, repoId, issueNumber: row.number }, "[sync-scheduler] failed to sync comments") })
          .finally(() => {
            active--
            finished++
            if (finished === count) resolve()
            else next()
          })
      }
    }
    next()
  })

  for (const { issueNum, comments } of commentResults) {
    for (const gc of comments) {
      const values = {
        id: `${repoId}_c${gc.id}`,
        issueId: issueId(repoId, issueNum),
        repoId,
        authorLogin: gc.user.login,
        authorAvatar: gc.user.avatar_url ?? null,
        body: gc.body,
        createdAt: new Date(gc.created_at).getTime(),
        updatedAt: new Date(gc.updated_at).getTime(),
      }
      const { id: _id, createdAt: _ca, ...updateSet } = values
      await db.insert(issueComments).values(values).onConflictDoUpdate({ target: issueComments.id, set: updateSet })
    }
    totalComments += comments.length
  }

  const allDbIssues = await db.select({ id: issues.id, labels: issues.labels }).from(issues).where(eq(issues.repoId, repoId))
  const seenTags = new Map<string, string>()
  let totalTags = 0

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

  let totalPrs = 0
  try {
    const states: Array<"open" | "closed"> = ["open", "closed"]
    for (const s of states) {
      let page = 1
      const limit = 50
      while (true) {
        const batch = await client.listPullRequests({ state: s, page, limit })
        if (batch.length === 0) break

        const enriched: Array<{ detail: GitPullRequest; diffStats: Array<{ filename: string; status: string; additions: number; deletions: number }> | null }> = []
        let prActive = 0
        const prQueue = [...batch]

        await new Promise<void>((resolve) => {
          if (prQueue.length === 0) return resolve()
          let finished = 0
          const count = prQueue.length

          function next() {
            while (prActive < CONCURRENCY && prQueue.length > 0) {
              const gpr = prQueue.shift()!
              prActive++
              Promise.all([
                client.getPullRequest(gpr.number).catch(() => gpr),
                client.listPullRequestFiles(gpr.number).catch(() => null),
              ])
                .then(([detail, files]) => {
                  const diffStats = files
                    ? files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }))
                    : null
                  enriched.push({ detail: detail as GitPullRequest, diffStats })
                })
                .finally(() => {
                  prActive--
                  finished++
                  if (finished === count) resolve()
                  else next()
                })
            }
          }
          next()
        })

        for (const { detail, diffStats } of enriched) {
          const values = {
            id: prId(repoId, detail.number),
            repoId,
            number: detail.number,
            title: detail.title,
            body: detail.body || null,
            state: detail.merged_at ? "merged" : detail.state,
            headBranch: detail.head?.ref ?? "",
            baseBranch: detail.base?.ref ?? "",
            labels: detail.labels?.map((l) => ({ id: l.id, name: l.name, color: l.color })) ?? [],
            htmlUrl: detail.html_url,
            authorLogin: detail.user?.login ?? null,
            authorAvatar: detail.user?.avatar_url ?? null,
            assignees: detail.assignees?.map((a) => ({ login: a.login, avatar_url: a.avatar_url })) ?? [],
            mergeable: detail.mergeable === true ? "true" : detail.mergeable === false ? "false" : null,
            draft: detail.draft ? 1 : 0,
            commentCount: detail.comments ?? 0,
            additions: detail.additions ?? null,
            deletions: detail.deletions ?? null,
            changedFilesCount: detail.changed_files ?? null,
            commitCount: detail.commits ?? null,
            createdAt: new Date(detail.created_at).getTime(),
            updatedAt: new Date(detail.updated_at).getTime(),
            mergedAt: detail.merged_at ? new Date(detail.merged_at).getTime() : null,
            diffStats,
          }
          const { id: _id, createdAt: _ca, ...updateSet } = values
          await db.insert(pullRequests).values(values).onConflictDoUpdate({ target: pullRequests.id, set: updateSet })
        }

        totalPrs += batch.length
        if (batch.length < limit) break
        page++
      }
    }
  } catch (err) {
    logger.warn({ err, repoId }, "[sync-scheduler] failed to sync PRs")
  }

  const allPrs = await db.select({ id: pullRequests.id, number: pullRequests.number, body: pullRequests.body })
    .from(pullRequests).where(eq(pullRequests.repoId, repoId))
  let totalLinks = 0
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

  logger.info({ repoId, totalIssues, totalComments, totalTags, totalPrs, totalLinks }, "[sync-scheduler] repo sync complete")
}

async function runFullSync(): Promise<void> {
  const allRepos = await db.select({ id: repos.id, gitUrl: repos.gitUrl }).from(repos)
  if (allRepos.length === 0) return

  logger.info({ repoCount: allRepos.length }, "[sync-scheduler] starting full sync")

  let active = 0
  const queue = [...allRepos]

  await new Promise<void>((resolve) => {
    let finished = 0
    const total = queue.length

    function next() {
      while (active < REPO_CONCURRENCY && queue.length > 0) {
        const repo = queue.shift()!
        active++
        syncRepo(repo.id, repo.gitUrl)
          .catch((err) => { logger.error({ err, repoId: repo.id }, "[sync-scheduler] repo sync failed") })
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

  logger.info("[sync-scheduler] full sync complete")
}

export function startSyncScheduler(): void {
  logger.info({ intervalMs: SYNC_INTERVAL_MS }, "[sync-scheduler] started")
  runFullSync().catch((err) => { logger.error({ err }, "[sync-scheduler] initial sync failed") })
  timer = setInterval(() => {
    runFullSync().catch((err) => { logger.error({ err }, "[sync-scheduler] scheduled sync failed") })
  }, SYNC_INTERVAL_MS)
}

export function stopSyncScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    logger.info("[sync-scheduler] stopped")
  }
}

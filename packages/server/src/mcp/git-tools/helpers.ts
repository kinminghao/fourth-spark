import { eq } from "drizzle-orm"
import { db } from "../../db/index"
import { repos, sessionLinks, sessions as sessionsTable, workspaces } from "../../db/schema"
import { parseGitUrl } from "../../lib/git-url"
import { getHostInfo, createGitIssueClient, type GitIssue, type GitComment, type GitPullRequest } from "../../lib/git-provider"
import { runtimeManager } from "../../lib/process-manager"
import { logger } from "../../middleware/logger"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function getClientForRepo(repoId: string) {
  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId))
  if (!repo) throw new Error(`Repo ${repoId} not found in database`)

  const remote = parseGitUrl(repo.gitUrl)
  if (!remote) throw new Error(`Cannot parse git URL: ${repo.gitUrl}`)

  const info = await getHostInfo(remote.host)
  if (!info) throw new Error(`No credentials configured for host: ${remote.host}`)

  const client = createGitIssueClient(remote.host, remote.owner, remote.repo, info.token, info.platform)
  return { repo, remote, info, client }
}

export function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
}

export function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true }
}

export function issueToDb(repoId: string, gi: GitIssue) {
  return {
    id: `${repoId}_${gi.number}`,
    repoId,
    number: gi.number,
    title: gi.title,
    body: gi.body || null,
    state: gi.state,
    labels: gi.labels?.map((l) => ({ id: l.id, name: l.name, color: l.color })) ?? [],
    htmlUrl: gi.html_url,
    authorLogin: gi.user?.login ?? null,
    authorAvatar: gi.user?.avatar_url ?? null,
    assignees: gi.assignees ?? [],
    commentCount: gi.comments ?? 0,
    createdAt: new Date(gi.created_at).getTime(),
    updatedAt: new Date(gi.updated_at).getTime(),
  }
}

export function commentToDb(repoId: string, issueNum: number, gc: GitComment) {
  return {
    id: `${repoId}_c${gc.id}`,
    issueId: `${repoId}_${issueNum}`,
    repoId,
    authorLogin: gc.user.login,
    authorAvatar: gc.user.avatar_url ?? null,
    body: gc.body,
    createdAt: new Date(gc.created_at).getTime(),
    updatedAt: new Date(gc.updated_at).getTime(),
  }
}

export function prToDb(repoId: string, pr: GitPullRequest) {
  return {
    id: `${repoId}_pr_${pr.number}`,
    repoId,
    number: pr.number,
    title: pr.title,
    body: pr.body || null,
    state: pr.state,
    headBranch: pr.head.ref,
    baseBranch: pr.base.ref,
    labels: pr.labels?.map((l) => ({ id: l.id, name: l.name, color: l.color })) ?? [],
    htmlUrl: pr.html_url,
    authorLogin: pr.user.login,
    authorAvatar: pr.user.avatar_url,
    assignees: pr.assignees ?? [],
    mergeable: pr.mergeable === null ? null : String(pr.mergeable),
    draft: pr.draft ? 1 : 0,
    commentCount: pr.comments ?? 0,
    additions: pr.additions ?? null,
    deletions: pr.deletions ?? null,
    changedFilesCount: pr.changed_files ?? null,
    commitCount: pr.commits ?? null,
    createdAt: new Date(pr.created_at).getTime(),
    updatedAt: new Date(pr.updated_at).getTime(),
    mergedAt: pr.merged_at ? new Date(pr.merged_at).getTime() : null,
  }
}

/**
 * Resolve the session that initiated the MCP call. When `knownSessionId` is
 * provided (session-specific MCP endpoint), return it directly. Otherwise fall
 * back to runtime heuristic: return the session only when exactly ONE is busy.
 * Multiple busy sessions → return null to avoid mis-association (#539).
 */
export async function resolveSessionId(repoId: string, knownSessionId?: string): Promise<string | null> {
  if (knownSessionId) return knownSessionId

  try {
    const client = runtimeManager.getClient(repoId)
    if (!client) return null
    const statuses = await client.getSessionStatus()
    const busySessions = Object.entries(statuses)
      .filter(([_, status]) => status.type === "busy")

    if (busySessions.length === 1) return busySessions[0][0]

    if (busySessions.length > 1) {
      logger.warn({ repoId, count: busySessions.length },
        "multiple busy sessions — skipping auto-link to avoid mis-association")
    }
  } catch (err) {
    logger.warn({ err, repoId }, "failed to resolve session for auto-link")
  }
  return null
}

export async function renameWorkspaceBranch(repoId: string, head: string, knownSessionId?: string): Promise<void> {
  const sessionId = await resolveSessionId(repoId, knownSessionId)
  if (!sessionId) return

  const [session] = await db.select({ workspaceId: sessionsTable.workspaceId })
    .from(sessionsTable).where(eq(sessionsTable.id, sessionId))
  if (!session?.workspaceId) return

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId))
  if (!workspace || !workspace.branch.startsWith("ws/")) return
  if (workspace.branch === head) return

  const cwd = workspace.localPath

  const renameResult = Bun.spawnSync(["git", "branch", "-m", workspace.branch, head], { cwd })
  if (renameResult.exitCode !== 0) {
    const stderr = renameResult.stderr.toString().trim()
    logger.warn({ repoId, from: workspace.branch, to: head, stderr }, "MCP: branch rename failed, continuing with original name")
    return
  }

  const pushResult = Bun.spawnSync(["git", "push", "-u", "origin", head], { cwd })
  if (pushResult.exitCode !== 0) {
    const stderr = pushResult.stderr.toString().trim()
    logger.warn({ repoId, branch: head, stderr }, "MCP: push after rename failed")
  }

  await db.update(workspaces).set({ branch: head, updatedAt: Date.now() }).where(eq(workspaces.id, workspace.id))
  logger.info({ repoId, from: workspace.branch, to: head }, "MCP: renamed workspace branch for PR")
}

export async function linkSessionTarget(repoId: string, type: "issue" | "pr", targetId: string, knownSessionId?: string): Promise<void> {
  const sessionId = await resolveSessionId(repoId, knownSessionId)
  if (!sessionId) return
  try {
    await db.insert(sessionLinks).values({
      sessionId,
      type,
      targetId,
      createdAt: Date.now(),
    }).onConflictDoNothing()
    logger.info({ sessionId, type, targetId }, "auto-linked session to target")
  } catch (err) {
    logger.warn({ err, sessionId, type, targetId }, "failed to auto-link session")
  }
}

import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { repos } from "../db/schema"
import { parseGitUrl } from "./git-url"
import { createGitIssueClient, getHostInfo, type GitIssue, type GitComment, type GitPullRequest } from "./git-provider"

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

export function issueId(repoId: string, number: number): string {
  return `${repoId}_${number}`
}

export function prId(repoId: string, number: number): string {
  return `${repoId}_pr_${number}`
}

// ---------------------------------------------------------------------------
// Git entity → DB record mappers
// ---------------------------------------------------------------------------

export function issueToDb(repoId: string, gi: GitIssue) {
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

export function commentToDb(repoId: string, issueNum: number, gc: GitComment) {
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

export function prToDb(repoId: string, gpr: GitPullRequest) {
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

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

export function extractUpstreamMessage(raw: string): string {
  const jsonMatch = raw.match(/\{.*"message"\s*:\s*"([^"]+)"/)
  if (jsonMatch?.[1]) return jsonMatch[1]
  const arrow = raw.indexOf("→")
  return arrow >= 0 ? raw.slice(arrow + 1).trim() : raw
}

export function rewriteAttachmentUrls(text: string | null | undefined, repoId: string): string | null {
  if (!text) return text ?? null
  const proxyBase = `/api/repos/${repoId}/issues/attachments`
  return text
    .replace(/src="\/?(attachments\/)/g, `src="${proxyBase}/`)
    .replace(/\]\(\/?(attachments\/)/g, `](${proxyBase}/`)
}

// ---------------------------------------------------------------------------
// Shared repo client resolver
// ---------------------------------------------------------------------------

export async function getRepoGitClient(repoId: string) {
  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId))
  if (!repo) return null
  const remote = parseGitUrl(repo.gitUrl)
  if (!remote) return null
  const info = await getHostInfo(remote.host)
  if (!info) return null
  const client = createGitIssueClient(remote.host, remote.owner, remote.repo, info.token, info.platform)
  return { repo, remote, client, platform: info.platform }
}

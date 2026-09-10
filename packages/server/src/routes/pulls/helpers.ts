import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "../../db/index"
import { repos } from "../../db/schema"
import { parseGitUrl } from "../../lib/git-url"
import { createGitIssueClient, getHostInfo, type GitPullRequest } from "../../lib/git-provider"

// ---------------------------------------------------------------------------
// Request body schemas
// ---------------------------------------------------------------------------

export const SyncPullsBody = z.object({
  state: z.enum(["open", "closed", "all"]).optional(),
})

export const LinkIssueBody = z.object({
  issueNumber: z.number().int().positive(),
})

export function prId(repoId: string, number: number): string {
  return `${repoId}_pr_${number}`
}

export function rewriteAttachmentUrls(text: string | null | undefined, repoId: string): string | null {
  if (!text) return text ?? null
  const proxyBase = `/api/repos/${repoId}/issues/attachments`
  return text
    .replace(/src="\/?(attachments\/)/g, `src="${proxyBase}/`)
    .replace(/\]\(\/?(attachments\/)/g, `](${proxyBase}/`)
}

export function extractUpstreamMessage(raw: string): string {
  const jsonMatch = raw.match(/\{.*"message"\s*:\s*"([^"]+)"/)
  if (jsonMatch?.[1]) return jsonMatch[1]
  const arrow = raw.indexOf("→")
  return arrow >= 0 ? raw.slice(arrow + 1).trim() : raw
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

export function parseIssueRefs(body: string | null | undefined): number[] {
  if (!body) return []
  const nums = new Set<number>()
  const keyword = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|ref)\s+#(\d+)/gi
  let m: RegExpExecArray | null
  while ((m = keyword.exec(body)) !== null) nums.add(Number(m[1]))
  const bare = /(?:^|[\s,;(])#(\d+)\b/gm
  while ((m = bare.exec(body)) !== null) nums.add(Number(m[1]))
  return [...nums]
}

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

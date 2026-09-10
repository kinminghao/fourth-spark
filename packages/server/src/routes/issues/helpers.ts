import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "../../db/index"
import { repos } from "../../db/schema"
import { parseGitUrl } from "../../lib/git-url"
import { createGitIssueClient, getHostInfo, type GitIssue, type GitComment } from "../../lib/git-provider"

// ---------------------------------------------------------------------------
// Request body schemas
// ---------------------------------------------------------------------------

export const SyncIssuesBody = z.object({
  state: z.enum(["open", "closed", "all"]).optional(),
})

export const CreateIssueBody = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
})

export const AddChildBody = z.object({
  childNumber: z.number().int().positive(),
})

export const MergeCloseBody = z.object({
  closeIssue: z.boolean().optional(),
})

export const UpdateIssueBody = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  state: z.enum(["open", "closed"]).optional(),
})

export const PolishDraftBody = z.object({
  draft: z.string().min(1),
})

export const CreateCommentBody = z.object({
  body: z.string().min(1),
})

export const PolishCreateBody = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
})

export const DRAFT_DIR = "/tmp/fourth-spark/drafts"

export function draftPath(repoId: string, issueNumber: number): string {
  return `${DRAFT_DIR}/${repoId}-${issueNumber}.md`
}

export function issueCreateDraftPath(repoId: string): string {
  return `${DRAFT_DIR}/${repoId}-new-issue.md`
}

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

export function issueId(repoId: string, number: number): string {
  return `${repoId}_${number}`
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

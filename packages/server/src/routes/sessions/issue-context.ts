import { eq, inArray, asc } from "drizzle-orm"
import { db } from "../../db/index"
import { issues, issueComments, repos } from "../../db/schema"
import { parseGitUrl } from "../../lib/git-url"
import { getHostInfo, getAuthenticatedLogin, createGitIssueClient } from "../../lib/git-provider"

export async function autoAssignIssue(repo: typeof repos.$inferSelect, issueId: string) {
  const [issue] = await db.select().from(issues).where(eq(issues.id, issueId))
  if (!issue) return

  const remote = parseGitUrl(repo.gitUrl)
  if (!remote) return
  const info = await getHostInfo(remote.host)
  if (!info) return

  const login = await getAuthenticatedLogin(remote.host, info.token, info.platform)
  const existing = issue.assignees ?? []
  if (existing.some((a) => a.login === login)) return

  const gitClient = createGitIssueClient(remote.host, remote.owner, remote.repo, info.token, info.platform)
  const updated = await gitClient.updateIssue(issue.number, {
    assignees: [...existing.map((a) => a.login), login],
  })

  await db.update(issues).set({
    assignees: updated.assignees?.map((a) => ({ login: a.login, avatar_url: a.avatar_url })) ?? [],
  }).where(eq(issues.id, issueId))
}

export function stripMedia(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<a[^>]+href="[^"]*attachments[^"]*"[^>]*>.*?<\/a>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export const MAX_ANCESTOR_DEPTH = 10
export const MAX_ANCESTOR_COMMENTS = 5

export async function collectAncestorChain(issueId: string) {
  const chain: (typeof issues.$inferSelect)[] = []
  const visited = new Set<string>()
  let currentId: string | null = issueId

  while (currentId && chain.length < MAX_ANCESTOR_DEPTH) {
    if (visited.has(currentId)) break
    visited.add(currentId)
    const [issue] = await db.select().from(issues).where(eq(issues.id, currentId))
    if (!issue) break
    chain.push(issue)
    currentId = issue.parentId
  }

  return chain.reverse()
}

export async function buildIssueContext(issueId: string): Promise<string | null> {
  const chain = await collectAncestorChain(issueId)
  if (chain.length === 0) return null

  const allIds = chain.map((i) => i.id)
  const allComments = await db.select().from(issueComments)
    .where(inArray(issueComments.issueId, allIds))
    .orderBy(asc(issueComments.createdAt))

  const commentMap = Map.groupBy(allComments, (c) => c.issueId)

  const sections = chain.map((issue, i) => {
    const isLeaf = i === chain.length - 1
    const header = isLeaf
      ? `## 当前 Issue: [#${issue.number}] ${issue.title}`
      : `## 上级 Issue (Level ${i}): [#${issue.number}] ${issue.title}`

    const parts = [header]

    if (issue.body) {
      const cleaned = stripMedia(issue.body)
      if (cleaned) parts.push(cleaned)
    }

    let comments = commentMap.get(issue.id) ?? []
    if (!isLeaf && comments.length > MAX_ANCESTOR_COMMENTS) {
      comments = comments.slice(-MAX_ANCESTOR_COMMENTS)
    }
    if (comments.length > 0) {
      const lines = comments.map((c) => {
        const date = new Date(c.createdAt).toISOString().slice(0, 10)
        const cleaned = stripMedia(c.body)
        return `**${c.authorLogin}** (${date}):\n${cleaned}`
      })
      parts.push(`### Comments\n\n${lines.join("\n\n")}`)
    }

    return parts.join("\n\n")
  })

  return sections.join("\n\n---\n\n")
}

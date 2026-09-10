import { z } from "zod"

// Re-export shared helpers from lib/git-utils so consumers import from one place
export { prId, prToDb, extractUpstreamMessage, rewriteAttachmentUrls, getRepoGitClient } from "../../lib/git-utils"

// ---------------------------------------------------------------------------
// Request body schemas
// ---------------------------------------------------------------------------

export const SyncPullsBody = z.object({
  state: z.enum(["open", "closed", "all"]).optional(),
})

export const LinkIssueBody = z.object({
  issueNumber: z.number().int().positive(),
})

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

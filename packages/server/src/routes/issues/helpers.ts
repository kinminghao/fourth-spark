import { z } from "zod"

// Re-export shared helpers from lib/git-utils so consumers import from one place
export { issueId, issueToDb, commentToDb, extractUpstreamMessage, rewriteAttachmentUrls, getRepoGitClient } from "../../lib/git-utils"

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

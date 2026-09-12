import { join } from "node:path"
import { z } from "zod"

import { TMP_BASE_DIR } from "../../lib/config"

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

export const DRAFT_DIR = join(TMP_BASE_DIR, "drafts")

/** Strip anything that isn't alphanumeric, underscore, or hyphen to prevent path traversal. */
function safeRepoId(repoId: string): string {
  return repoId.replace(/[^a-zA-Z0-9_-]/g, "_")
}

export function draftPath(repoId: string, issueNumber: number): string {
  return `${DRAFT_DIR}/${safeRepoId(repoId)}-${issueNumber}.md`
}

export function issueCreateDraftPath(repoId: string): string {
  return `${DRAFT_DIR}/${safeRepoId(repoId)}-new-issue.md`
}

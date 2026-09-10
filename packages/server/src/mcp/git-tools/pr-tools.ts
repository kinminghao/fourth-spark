import { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "../../db/index"
import { issueComments, pullRequests } from "../../db/schema"
import { logger } from "../../middleware/logger"
import {
  getClientForRepo,
  textResult,
  errorResult,
  commentToDb,
  prToDb,
  renameWorkspaceBranch,
  linkSessionTarget,
} from "./helpers"

export function registerPrTools(server: McpServer, repoId: string, sessionId?: string): void {
  // ── list_pull_requests ────────────────────────────────────────────────────
  server.registerTool(
    "list_pull_requests",
    {
      description: "List pull requests from the Git platform (GitHub/Gitea/GitLab)",
      inputSchema: z.object({
        state: z.enum(["open", "closed", "all"]).optional().describe("Filter by PR state, defaults to 'open'"),
        page: z.number().int().positive().optional().describe("Page number for pagination"),
        limit: z.number().int().positive().max(100).optional().describe("Max PRs per page, defaults to 50"),
      }),
    },
    async ({ state, page, limit }) => {
      try {
        const { client } = await getClientForRepo(repoId)
        const prs = await client.listPullRequests({ state, page, limit })
        return textResult(prs)
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )

  // ── get_pull_request ─────────────────────────────────────────────────────
  server.registerTool(
    "get_pull_request",
    {
      description: "Get a single pull request by number",
      inputSchema: z.object({
        pr_number: z.number().int().positive().describe("Pull request number"),
      }),
    },
    async ({ pr_number }) => {
      try {
        const { client } = await getClientForRepo(repoId)
        const pr = await client.getPullRequest(pr_number)
        return textResult(pr)
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )

  // ── create_pull_request ──────────────────────────────────────────────────
  server.registerTool(
    "create_pull_request",
    {
      description: "Create a pull request. If issue_number is provided, the PR body will include 'Closes #N' to auto-close the issue on merge, and a comment linking the PR will be added to the issue.",
      inputSchema: z.object({
        title: z.string().describe("PR title"),
        body: z.string().optional().describe("PR body (Markdown)"),
        head: z.string().describe("Source branch name"),
        base: z.string().describe("Target branch name (e.g. 'main')"),
        issue_number: z.number().int().positive().optional().describe("Issue number to link — adds 'Closes #N' and comments on the issue"),
      }),
    },
    async ({ title, body, head, base, issue_number }) => {
      try {
        const { client } = await getClientForRepo(repoId)

        await renameWorkspaceBranch(repoId, head, sessionId)

        let prBody = body ?? ""
        if (issue_number) {
          const closeRef = `Closes #${issue_number}`
          prBody = prBody ? `${prBody}\n\n${closeRef}` : closeRef
        }

        const pr = await client.createPullRequest({ title, body: prBody, head, base })
        logger.info({ repoId, prNumber: pr.number, issue_number }, "MCP: created pull request")

        const prValues = prToDb(repoId, pr)
        const { id: _prId, createdAt: _prCreatedAt, ...prUpdateSet } = prValues
        await db.insert(pullRequests).values(prValues).onConflictDoUpdate({ target: pullRequests.id, set: prUpdateSet })

        await linkSessionTarget(repoId, "pr", prValues.id, sessionId)

        if (issue_number) {
          try {
            await client.createComment(issue_number, `PR #${pr.number} created: ${pr.html_url}`)
          } catch (commentErr) {
            logger.warn({ repoId, issue_number, err: commentErr }, "MCP: failed to comment on linked issue")
          }
        }

        return textResult(pr)
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )

  // ── list_pr_comments ──────────────────────────────────────────────────────
  server.registerTool(
    "list_pr_comments",
    {
      description: "List comments on a pull request",
      inputSchema: z.object({
        pr_number: z.number().int().positive().describe("Pull request number"),
      }),
    },
    async ({ pr_number }) => {
      try {
        const { client } = await getClientForRepo(repoId)
        const comments = await client.listComments(pr_number)
        return textResult(comments)
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )

  // ── create_pr_comment ──────────────────────────────────────────────────
  server.registerTool(
    "create_pr_comment",
    {
      description: "Add a comment to a pull request",
      inputSchema: z.object({
        pr_number: z.number().int().positive().describe("Pull request number"),
        body: z.string().describe("Comment body (Markdown)"),
      }),
    },
    async ({ pr_number, body }) => {
      try {
        const { client } = await getClientForRepo(repoId)
        const comment = await client.createComment(pr_number, body)
        const values = commentToDb(repoId, pr_number, comment)
        await db.insert(issueComments).values(values).onConflictDoNothing()
        logger.info({ repoId, prNumber: pr_number }, "MCP: created PR comment")
        return textResult({ ok: true, pr_number })
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )

  // ── merge_pull_request ───────────────────────────────────────────────────
  server.registerTool(
    "merge_pull_request",
    {
      description: "Merge a pull request by number",
      inputSchema: z.object({
        pr_number: z.number().int().positive().describe("Pull request number"),
      }),
    },
    async ({ pr_number }) => {
      try {
        const { client } = await getClientForRepo(repoId)
        await client.mergePullRequest(pr_number)
        const prId = `${repoId}_pr_${pr_number}`
        await db.update(pullRequests)
          .set({ state: "closed", mergedAt: Date.now(), updatedAt: Date.now() })
          .where(eq(pullRequests.id, prId))
        logger.info({ repoId, prNumber: pr_number }, "MCP: merged pull request")
        return textResult({ ok: true, pr_number })
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )
}

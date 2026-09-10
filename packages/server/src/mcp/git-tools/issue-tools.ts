import { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import { db } from "../../db/index"
import { issues, issueComments } from "../../db/schema"
import { logger } from "../../middleware/logger"
import {
  getClientForRepo,
  textResult,
  errorResult,
  issueToDb,
  commentToDb,
  linkSessionTarget,
} from "./helpers"

export function registerIssueTools(server: McpServer, repoId: string, sessionId?: string): void {
  // ── get_repo_info ────────────────────────────────────────────────────────
  server.registerTool(
    "get_repo_info",
    {
      description: "Get current repository information: owner, repo name, host, platform, and git URL",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const { repo, remote, platform } = await getClientForRepo(repoId)
        return textResult({
          repoId: repo.id,
          name: repo.name,
          gitUrl: repo.gitUrl,
          host: remote.host,
          owner: remote.owner,
          repo: remote.repo,
          platform,
        })
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )

  // ── list_issues ──────────────────────────────────────────────────────────
  server.registerTool(
    "list_issues",
    {
      description: "List issues from the Git platform (GitHub/Gitea/GitLab)",
      inputSchema: z.object({
        state: z.enum(["open", "closed", "all"]).optional().describe("Filter by issue state, defaults to 'open'"),
        page: z.number().int().positive().optional().describe("Page number for pagination"),
        limit: z.number().int().positive().max(100).optional().describe("Max issues per page, defaults to 50"),
      }),
    },
    async ({ state, page, limit }) => {
      try {
        const { client } = await getClientForRepo(repoId)
        const issues = await client.listIssues({ state, page, limit })
        return textResult(issues)
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )

  // ── get_issue ────────────────────────────────────────────────────────────
  server.registerTool(
    "get_issue",
    {
      description: "Get a single issue by number",
      inputSchema: z.object({
        number: z.number().int().positive().describe("Issue number"),
      }),
    },
    async ({ number }) => {
      try {
        const { client } = await getClientForRepo(repoId)
        const issue = await client.getIssue(number)
        return textResult(issue)
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )

  // ── create_issue ─────────────────────────────────────────────────────────
  server.registerTool(
    "create_issue",
    {
      description: "Create a new issue on the Git platform",
      inputSchema: z.object({
        title: z.string().describe("Issue title"),
        body: z.string().optional().describe("Issue body (Markdown)"),
      }),
    },
    async ({ title, body }) => {
      try {
        const { client } = await getClientForRepo(repoId)
        const issue = await client.createIssue({ title, body })
        const values = issueToDb(repoId, issue)
        await db.insert(issues).values(values).onConflictDoNothing()
        logger.info({ repoId, issueNumber: issue.number }, "MCP: created issue")
        await linkSessionTarget(repoId, "issue", values.id, sessionId)
        return textResult(issue)
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )

  // ── update_issue ─────────────────────────────────────────────────────────
  server.registerTool(
    "update_issue",
    {
      description: "Update an existing issue (title, body, or state)",
      inputSchema: z.object({
        number: z.number().int().positive().describe("Issue number"),
        title: z.string().optional().describe("New title"),
        body: z.string().optional().describe("New body (Markdown)"),
        state: z.enum(["open", "closed"]).optional().describe("New state"),
      }),
    },
    async ({ number, title, body, state }) => {
      try {
        const { client } = await getClientForRepo(repoId)
        const issue = await client.updateIssue(number, { title, body, state })
        const values = issueToDb(repoId, issue)
        const { id: _, createdAt: __, ...updateSet } = values
        await db.insert(issues).values(values).onConflictDoUpdate({ target: issues.id, set: updateSet })
        logger.info({ repoId, issueNumber: number }, "MCP: updated issue")
        return textResult(issue)
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )

  // ── create_comment ───────────────────────────────────────────────────────
  server.registerTool(
    "create_comment",
    {
      description: "Add a comment to an issue",
      inputSchema: z.object({
        issue_number: z.number().int().positive().describe("Issue number"),
        body: z.string().describe("Comment body (Markdown)"),
      }),
    },
    async ({ issue_number, body }) => {
      try {
        const { client } = await getClientForRepo(repoId)
        const comment = await client.createComment(issue_number, body)
        const values = commentToDb(repoId, issue_number, comment)
        await db.insert(issueComments).values(values).onConflictDoNothing()
        logger.info({ repoId, issueNumber: issue_number }, "MCP: created comment")
        return textResult({ ok: true, issue_number })
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )

  // ── list_comments ────────────────────────────────────────────────────────
  server.registerTool(
    "list_comments",
    {
      description: "List comments on an issue",
      inputSchema: z.object({
        issue_number: z.number().int().positive().describe("Issue number"),
      }),
    },
    async ({ issue_number }) => {
      try {
        const { client } = await getClientForRepo(repoId)
        const comments = await client.listComments(issue_number)
        return textResult(comments)
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )
}

import { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { repos } from "../db/schema"
import { parseGitUrl } from "../lib/git-url"
import { getHostInfo, createGitIssueClient, type GitIssueClient } from "../lib/git-provider"
import { logger } from "../middleware/logger"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getClientForRepo(repoId: string) {
  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId))
  if (!repo) throw new Error(`Repo ${repoId} not found in database`)

  const remote = parseGitUrl(repo.gitUrl)
  if (!remote) throw new Error(`Cannot parse git URL: ${repo.gitUrl}`)

  const info = await getHostInfo(remote.host)
  if (!info) throw new Error(`No credentials configured for host: ${remote.host}`)

  const client = createGitIssueClient(remote.host, remote.owner, remote.repo, info.token, info.platform)
  return { repo, remote, info, client }
}

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true }
}

// ---------------------------------------------------------------------------
// MCP Server Factory — called per-request by createMcpHandler
// ---------------------------------------------------------------------------

export function buildGitMcpServer(repoId: string): McpServer {
  const server = new McpServer({
    name: "fourth-spark-git",
    version: "1.0.0",
  })

  // ── get_repo_info ────────────────────────────────────────────────────────
  server.registerTool(
    "get_repo_info",
    {
      description: "Get current repository information: owner, repo name, host, platform, and git URL",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const { repo, remote, info } = await getClientForRepo(repoId)
        return textResult({
          repoId: repo.id,
          name: repo.name,
          gitUrl: repo.gitUrl,
          host: remote.host,
          owner: remote.owner,
          repo: remote.repo,
          platform: info.platform,
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
        logger.info({ repoId, issueNumber: issue.number }, "MCP: created issue")
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
        await client.createComment(issue_number, body)
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

        let prBody = body ?? ""
        if (issue_number) {
          const closeRef = `Closes #${issue_number}`
          prBody = prBody ? `${prBody}\n\n${closeRef}` : closeRef
        }

        const pr = await client.createPullRequest({ title, body: prBody, head, base })
        logger.info({ repoId, prNumber: pr.number, issue_number }, "MCP: created pull request")

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
        logger.info({ repoId, prNumber: pr_number }, "MCP: merged pull request")
        return textResult({ ok: true, pr_number })
      } catch (err) {
        return errorResult(String(err))
      }
    },
  )

  return server
}

import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { gitHosts } from "../db/schema"
import type { GitPlatformFactory } from "../core/types"

const ENV_TOKEN = process.env.GITEA_TOKEN ?? ""

export type Platform = "gitea" | "github" | "gitlab"

export interface HostInfo {
  token: string
  platform: Platform
}

export async function getHostInfo(host: string): Promise<HostInfo | null> {
  try {
    const [row] = await db.select().from(gitHosts).where(eq(gitHosts.host, host.toLowerCase()))
    if (row?.token) return { token: row.token, platform: row.platform as Platform }
  } catch {}
  if (ENV_TOKEN) return { token: ENV_TOKEN, platform: "gitea" }
  return null
}

export interface GitIssue {
  id: number
  number: number
  title: string
  body: string
  state: "open" | "closed"
  labels: Array<{ id: number; name: string; color: string }>
  html_url: string
  milestone: { id: number; title: string } | null
  user?: { login: string; avatar_url: string }
  assignees?: Array<{ login: string; avatar_url: string }>
  comments?: number
  created_at: string
  updated_at: string
}

export interface GitMilestone {
  id: number
  number: number    // GitHub field name; Gitea uses `id` for some endpoints
  title: string
  description: string
  state: "open" | "closed"
  due_on: string | null
  open_issues: number
  closed_issues: number
  created_at: string
  updated_at: string
}

export interface CreateIssueInput {
  title: string
  body?: string
  labels?: number[]
}

export interface UpdateIssueInput {
  title?: string
  body?: string
  state?: "open" | "closed"
}

export interface GitComment {
  id: number
  body: string
  user: { login: string; avatar_url: string }
  created_at: string
  updated_at: string
}

export interface GitPullRequest {
  number: number
  title: string
  body: string
  state: string
  html_url: string
  head: { ref: string; label?: string }
  base: { ref: string; label?: string }
  user: { login: string; avatar_url: string }
  assignees?: Array<{ login: string; avatar_url: string }>
  labels?: Array<{ id: number; name: string; color: string }>
  draft?: boolean
  comments?: number
  created_at: string
  updated_at: string
  merged_at?: string | null
  mergeable: boolean | null
  // Diff stats — available from individual PR detail endpoint, not from list
  additions?: number
  deletions?: number
  changed_files?: number
  commits?: number
}

export interface GitPrFile {
  filename: string
  status: string // "added" | "modified" | "removed" | "renamed"
  additions: number
  deletions: number
  changes: number
  previous_filename?: string
}

export interface GitPrCommit {
  sha: string
  message: string
  author: { name: string; email: string; date: string }
  committer: { name: string; email: string; date: string }
  html_url?: string
}

export interface CreatePullRequestInput {
  title: string
  body?: string
  head: string
  base: string
}

export interface GitIssueClient {
  listIssues(opts?: { state?: "open" | "closed" | "all"; page?: number; limit?: number }): Promise<GitIssue[]>
  getIssue(number: number): Promise<GitIssue>
  createIssue(input: CreateIssueInput): Promise<GitIssue>
  updateIssue(number: number, input: UpdateIssueInput): Promise<GitIssue>
  addDependency(issueNumber: number, dependsOnNumber: number): Promise<void>
  createComment(issueNumber: number, body: string): Promise<GitComment>
  listComments(issueNumber: number): Promise<GitComment[]>
  listMilestones(opts?: { state?: "open" | "closed" | "all" }): Promise<GitMilestone[]>
  createPullRequest(input: CreatePullRequestInput): Promise<GitPullRequest>
  listPullRequests(opts?: { state?: "open" | "closed" | "all"; page?: number; limit?: number }): Promise<GitPullRequest[]>
  getPullRequest(number: number): Promise<GitPullRequest>
  listIssuePullRequests(issueNumber: number): Promise<GitPullRequest[]>
  mergePullRequest(prNumber: number): Promise<void>
  listPullRequestFiles(prNumber: number): Promise<GitPrFile[]>
  listPullRequestCommits(prNumber: number): Promise<GitPrCommit[]>
}

export class GitApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "GitApiError"
    this.status = status
  }
}

function apiBase(host: string, platform: Platform): string {
  if (platform === "github") return "https://api.github.com"
  return `https://${host}/api/v1`
}

function authHeader(token: string, platform: Platform): string {
  if (platform === "github") return `Bearer ${token}`
  return `token ${token}`
}

export function createGitIssueClient(host: string, owner: string, repo: string, token: string, platform: Platform): GitIssueClient {
  const base = `${apiBase(host, platform)}/repos/${owner}/${repo}`

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${base}${path}`
    const headers: Record<string, string> = {
      Authorization: authHeader(token, platform),
      Accept: "application/json",
    }
    if (body !== undefined) headers["Content-Type"] = "application/json"

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new GitApiError(`${platform} ${method} ${path} → ${res.status}: ${text}`, res.status)
    }
    return (await res.json()) as T
  }

  function normalizePR(raw: Record<string, unknown>): GitPullRequest {
    const user = (raw.user as { login?: string; avatar_url?: string } | undefined) ?? {}
    const head = (raw.head as { ref?: string; label?: string } | undefined) ?? {}
    const baseBranch = (raw.base as { ref?: string; label?: string } | undefined) ?? {}
    return {
      number: raw.number as number,
      title: (raw.title as string) ?? "",
      body: (raw.body as string) ?? "",
      state: (raw.state as string) ?? "open",
      html_url: (raw.html_url as string) ?? "",
      head: { ref: head.ref ?? "", label: head.label },
      base: { ref: baseBranch.ref ?? "", label: baseBranch.label },
      user: { login: user.login ?? "", avatar_url: user.avatar_url ?? "" },
      assignees: Array.isArray(raw.assignees)
        ? (raw.assignees as Array<{ login: string; avatar_url: string }>)
        : [],
      labels: Array.isArray(raw.labels)
        ? (raw.labels as Array<{ id: number; name: string; color: string }>)
        : [],
      draft: typeof raw.draft === "boolean" ? raw.draft : false,
      comments: typeof raw.comments === "number" ? raw.comments : 0,
      created_at: (raw.created_at as string) ?? "",
      updated_at: (raw.updated_at as string) ?? "",
      merged_at: (raw.merged_at as string | null) ?? null,
      mergeable: typeof raw.mergeable === "boolean" ? raw.mergeable : null,
      additions: typeof raw.additions === "number" ? raw.additions : undefined,
      deletions: typeof raw.deletions === "number" ? raw.deletions : undefined,
      changed_files: typeof raw.changed_files === "number" ? raw.changed_files : undefined,
      commits: typeof raw.commits === "number" ? raw.commits : undefined,
    }
  }

  return {
    async listIssues(opts) {
      const params = new URLSearchParams()
      params.set("state", opts?.state ?? "open")
      params.set("page", String(opts?.page ?? 1))
      params.set("sort", "updated")

      if (platform === "github") {
        params.set("per_page", String(opts?.limit ?? 50))
        params.set("direction", "desc")
      } else {
        params.set("limit", String(opts?.limit ?? 50))
        params.set("type", "issues")
      }

      const raw = await request<(GitIssue & { pull_request?: unknown })[]>("GET", `/issues?${params}`)
      // GitHub's Issues API returns PRs mixed in; filter them out
      return platform === "github" ? raw.filter((i) => !i.pull_request) : raw
    },

    getIssue(number) {
      return request<GitIssue>("GET", `/issues/${number}`)
    },

    createIssue(input) {
      return request<GitIssue>("POST", "/issues", input)
    },

    updateIssue(number, input) {
      return request<GitIssue>("PATCH", `/issues/${number}`, input)
    },

    async addDependency(issueNumber, dependsOnNumber) {
      if (platform === "github") return
      await request<unknown>("POST", `/issues/${issueNumber}/dependencies`, {
        owner,
        repo,
        index: dependsOnNumber,
      })
    },

    async createComment(issueNumber, body) {
      return request<GitComment>("POST", `/issues/${issueNumber}/comments`, { body })
    },

    async listComments(issueNumber) {
      return request<GitComment[]>("GET", `/issues/${issueNumber}/comments?per_page=100`)
    },

    async listMilestones(opts) {
      const params = new URLSearchParams()
      params.set("state", opts?.state ?? "all")
      if (platform === "github") {
        params.set("per_page", "100")
        params.set("direction", "desc")
      } else {
        params.set("limit", "100")
      }
      return request<GitMilestone[]>("GET", `/milestones?${params}`)
    },

    async listPullRequests(opts) {
      const params = new URLSearchParams()
      const state = opts?.state ?? "open"
      params.set("state", state)
      params.set("sort", "updated")
      params.set("page", String(opts?.page ?? 1))

      if (platform === "github") {
        params.set("per_page", String(opts?.limit ?? 50))
        params.set("direction", "desc")
      } else {
        params.set("limit", String(opts?.limit ?? 50))
      }

      const raw = await request<Record<string, unknown>[]>("GET", `/pulls?${params}`)
      return raw.map((r) => normalizePR(r))
    },

    async getPullRequest(number) {
      const raw = await request<Record<string, unknown>>("GET", `/pulls/${number}`)
      return normalizePR(raw)
    },

    async createPullRequest(input) {
      const payload: Record<string, unknown> = {
        title: input.title,
        head: input.head,
        base: input.base,
      }
      if (input.body !== undefined) payload.body = input.body
      const raw = await request<Record<string, unknown>>("POST", "/pulls", payload)
      return normalizePR(raw)
    },

    async mergePullRequest(prNumber) {
      if (platform === "github") {
        await request<unknown>("PUT", `/pulls/${prNumber}/merge`, { merge_method: "merge" })
      } else {
        await request<unknown>("POST", `/pulls/${prNumber}/merge`, { Do: "merge" })
      }
    },

    async listPullRequestFiles(prNumber) {
      const params = platform === "github" ? "?per_page=300" : "?limit=300"
      const raw = await request<Record<string, unknown>[]>("GET", `/pulls/${prNumber}/files${params}`)
      return raw.map((f) => ({
        filename: (f.filename as string) ?? "",
        status: (f.status as string) ?? "modified",
        additions: typeof f.additions === "number" ? f.additions : 0,
        deletions: typeof f.deletions === "number" ? f.deletions : 0,
        changes: typeof f.changes === "number" ? f.changes : 0,
        previous_filename: (f.previous_filename as string | undefined),
      }))
    },

    async listPullRequestCommits(prNumber) {
      const params = platform === "github" ? "?per_page=250" : "?limit=250"
      const raw = await request<Record<string, unknown>[]>("GET", `/pulls/${prNumber}/commits${params}`)
      return raw.map((c) => {
        const commit = (c.commit as Record<string, unknown> | undefined) ?? {}
        const author = (commit.author as Record<string, unknown> | undefined) ?? {}
        const committer = (commit.committer as Record<string, unknown> | undefined) ?? {}
        return {
          sha: (c.sha as string) ?? "",
          message: (commit.message as string) ?? "",
          author: {
            name: (author.name as string) ?? "",
            email: (author.email as string) ?? "",
            date: (author.date as string) ?? "",
          },
          committer: {
            name: (committer.name as string) ?? "",
            email: (committer.email as string) ?? "",
            date: (committer.date as string) ?? "",
          },
          html_url: (c.html_url as string | undefined),
        }
      })
    },

    async listIssuePullRequests(issueNumber) {
      try {
        // Use timeline API to find cross-referenced PR numbers
        const events = await request<Record<string, unknown>[]>(
          "GET",
          `/issues/${issueNumber}/timeline`,
        )
        const prNumbers = new Set<number>()
        for (const event of events) {
          const ref =
            (event.ref_issue as Record<string, unknown> | undefined) ??
            ((event.source as Record<string, unknown> | undefined)?.issue as
              | Record<string, unknown>
              | undefined)
          if (!ref?.pull_request) continue
          const num = ref.number as number
          prNumbers.add(num)
        }

        const prs: GitPullRequest[] = []
        for (const prNum of prNumbers) {
          try {
            const raw = await request<Record<string, unknown>>("GET", `/pulls/${prNum}`)
            prs.push(normalizePR(raw))
          } catch {}
        }
        return prs
      } catch {
        return []
      }
    },
  }
}

export const githubPlatformFactory: GitPlatformFactory = {
  platform: "github",
  createClient: (host, owner, repo, token) => createGitIssueClient(host, owner, repo, token, "github"),
}

export const giteaPlatformFactory: GitPlatformFactory = {
  platform: "gitea",
  createClient: (host, owner, repo, token) => createGitIssueClient(host, owner, repo, token, "gitea"),
}

export const gitlabPlatformFactory: GitPlatformFactory = {
  platform: "gitlab",
  createClient: (host, owner, repo, token) => createGitIssueClient(host, owner, repo, token, "gitlab"),
}

import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { gitHosts } from "../db/schema"

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
  user: { login: string; avatar_url: string }
  created_at: string
  updated_at: string
  mergeable: boolean | null
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
  listIssuePullRequests(issueNumber: number): Promise<GitPullRequest[]>
  mergePullRequest(prNumber: number): Promise<void>
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

      return request<GitIssue[]>("GET", `/issues?${params}`)
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

    async createPullRequest(input) {
      const payload: Record<string, unknown> = {
        title: input.title,
        head: input.head,
        base: input.base,
      }
      if (input.body !== undefined) payload.body = input.body
      return request<GitPullRequest>("POST", platform === "github" ? "/pulls" : "/pulls", payload)
    },

    async mergePullRequest(prNumber) {
      if (platform === "github") {
        await request<unknown>("PUT", `/pulls/${prNumber}/merge`, { merge_method: "merge" })
      } else {
        await request<unknown>("POST", `/pulls/${prNumber}/merge`, { Do: "merge" })
      }
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
            const user = (raw.user as { login?: string; avatar_url?: string } | undefined) ?? {}
            prs.push({
              number: raw.number as number,
              title: (raw.title as string) ?? "",
              body: (raw.body as string) ?? "",
              state: (raw.state as string) ?? "open",
              html_url: (raw.html_url as string) ?? "",
              user: { login: user.login ?? "", avatar_url: user.avatar_url ?? "" },
              created_at: (raw.created_at as string) ?? "",
              updated_at: (raw.updated_at as string) ?? "",
              mergeable: typeof raw.mergeable === "boolean" ? raw.mergeable : null,
            })
          } catch {}
        }
        return prs
      } catch {
        return []
      }
    },
  }
}

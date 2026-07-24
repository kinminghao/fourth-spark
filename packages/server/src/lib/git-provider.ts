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
}

export interface GitIssueClient {
  listIssues(opts?: { state?: "open" | "closed" | "all"; page?: number; limit?: number }): Promise<GitIssue[]>
  getIssue(number: number): Promise<GitIssue>
  createIssue(input: CreateIssueInput): Promise<GitIssue>
  updateIssue(number: number, input: UpdateIssueInput): Promise<GitIssue>
  addDependency(issueNumber: number, dependsOnNumber: number): Promise<void>
  createComment(issueNumber: number, body: string): Promise<void>
  listComments(issueNumber: number): Promise<GitComment[]>
  listIssuePullRequests(issueNumber: number): Promise<GitPullRequest[]>
  mergePullRequest(prNumber: number): Promise<void>
}

class GitApiError extends Error {
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
      await request<unknown>("POST", `/issues/${issueNumber}/comments`, { body })
    },

    async listComments(issueNumber) {
      return request<GitComment[]>("GET", `/issues/${issueNumber}/comments?per_page=100`)
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
        // Use timeline API to find cross-referenced PRs
        // Gitea: ref_issue field; GitHub: source.issue field
        const events = await request<Record<string, unknown>[]>(
          "GET",
          `/issues/${issueNumber}/timeline`,
        )
        const prMap = new Map<number, GitPullRequest>()
        for (const event of events) {
          const ref =
            (event.ref_issue as Record<string, unknown> | undefined) ??
            ((event.source as Record<string, unknown> | undefined)?.issue as
              | Record<string, unknown>
              | undefined)
          if (!ref?.pull_request) continue
          const num = ref.number as number
          if (prMap.has(num)) continue
          const user = (ref.user as { login?: string; avatar_url?: string } | undefined) ?? {}
          prMap.set(num, {
            number: num,
            title: (ref.title as string) ?? "",
            body: (ref.body as string) ?? "",
            state: (ref.state as string) ?? "open",
            html_url: (ref.html_url as string) ?? "",
            user: { login: user.login ?? "", avatar_url: user.avatar_url ?? "" },
            created_at: (ref.created_at as string) ?? "",
            updated_at: (ref.updated_at as string) ?? "",
          })
        }
        return [...prMap.values()]
      } catch {
        return []
      }
    },
  }
}

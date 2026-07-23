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

export interface GitIssueClient {
  listIssues(opts?: { state?: "open" | "closed" | "all"; page?: number; limit?: number }): Promise<GitIssue[]>
  getIssue(number: number): Promise<GitIssue>
  createIssue(input: CreateIssueInput): Promise<GitIssue>
  updateIssue(number: number, input: UpdateIssueInput): Promise<GitIssue>
  addDependency(issueNumber: number, dependsOnNumber: number): Promise<void>
  createComment(issueNumber: number, body: string): Promise<void>
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
        dependsOn: [dependsOnNumber],
      })
    },

    async createComment(issueNumber, body) {
      await request<unknown>("POST", `/issues/${issueNumber}/comments`, { body })
    },
  }
}

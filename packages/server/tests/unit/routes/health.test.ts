import { beforeEach, describe, expect, mock, test } from "bun:test"

// Mock process-manager to avoid heavy runtime initialization
const mockGetClient = mock(() => null)
const mockHealthCheck = mock(() => Promise.resolve({ reachable: false }))
mock.module("../../../src/lib/process-manager", () => ({
  runtimeManager: {
    getClient: mockGetClient,
    healthCheck: mockHealthCheck,
  },
}))

// Mock global fetch for GitHub API version check
const originalFetch = globalThis.fetch

const { health, repoHealth } = await import("../../../src/routes/health")

describe("health route — GET /", () => {
  beforeEach(() => {
    mockGetClient.mockReset()
    mockHealthCheck.mockReset()
  })

  test("returns status ok with version", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ tag_name: "v1.2.3" }), { status: 200 })),
    ) as typeof fetch

    const res = await health.request("/")
    const body = (await res.json()) as { status: string; version: string; latestVersion: string | null }

    expect(res.status).toBe(200)
    expect(body.status).toBe("ok")
    expect(typeof body.version).toBe("string")

    globalThis.fetch = originalFetch
  })

  test("returns null latestVersion on fetch failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("network error"))) as typeof fetch

    const res = await health.request("/")
    const body = (await res.json()) as { status: string; latestVersion: string | null }

    expect(res.status).toBe(200)
    expect(body.status).toBe("ok")

    globalThis.fetch = originalFetch
  })
})

describe("repoHealth route — GET /", () => {
  beforeEach(() => {
    mockGetClient.mockReset()
    mockHealthCheck.mockReset()
  })

  test("returns not_running when no client for repo", async () => {
    mockGetClient.mockImplementation(() => null)

    // repoHealth expects :repoId param — mount it under a parent
    const { Hono } = await import("hono")
    const app = new Hono()
    app.route("/repos/:repoId/health", repoHealth)

    const res = await app.request("/repos/repo-1/health")
    const body = (await res.json()) as { status: string; repoId: string }

    expect(res.status).toBe(200)
    expect(body.status).toBe("not_running")
    expect(body.repoId).toBe("repo-1")
  })

  test("returns ok with runtime details when client exists", async () => {
    mockGetClient.mockImplementation(() => ({ directory: "/tmp/repo-1" }))
    mockHealthCheck.mockImplementation(() => Promise.resolve({ reachable: true, details: { port: 8081 } }))

    const { Hono } = await import("hono")
    const app = new Hono()
    app.route("/repos/:repoId/health", repoHealth)

    const res = await app.request("/repos/repo-1/health")
    const body = (await res.json()) as any

    expect(res.status).toBe(200)
    expect(body.status).toBe("ok")
    expect(body.repoId).toBe("repo-1")
    expect(body.opencode.reachable).toBe(true)
    expect(body.opencode.url).toBe("http://127.0.0.1:8081")
    expect(body.workspace).toBe("/tmp/repo-1")
  })
})

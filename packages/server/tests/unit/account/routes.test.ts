import { describe, expect, test } from "bun:test"
import type { AccountPoolRouteService } from "../../../src/account/routes"
import { createAccountPoolRoutes } from "../../../src/account/routes"
import type { LeaseOutcome, UsageSnapshotView } from "../../../src/account/types"

const NOW = 1_000_000_000
const MINUTE = 60_000

const oauthLease: LeaseOutcome = {
  ok: true,
  lease: {
    provider: "anthropic",
    accountId: "acc1",
    credential: { type: "oauth", access: "access-token", expires: NOW + 8 * 60 * MINUTE, accountId: "upstream" },
    leaseExpiresAt: NOW + 7 * 60 * MINUTE,
  },
}

const apiLease: LeaseOutcome = {
  ok: true,
  lease: {
    provider: "opencode-go",
    accountId: "go1",
    credential: { type: "api", key: "go-key" },
    leaseExpiresAt: NOW + 4 * 60 * MINUTE,
  },
}

const snapshot: UsageSnapshotView = {
  at: NOW,
  stale: false,
  accounts: [
    {
      provider: "anthropic",
      idPrefix: "acc1",
      label: "Claude One",
      windows: [{ label: "5 小时", utilization: 12 }],
      hasUsage: true,
      coolingDown: false,
      excluded: false,
      needsReauth: false,
      holders: ["w1"],
    },
  ],
}

function fakeService(overrides: Partial<AccountPoolRouteService> = {}): AccountPoolRouteService {
  return {
    acquire: async () => oauthLease,
    reportLimit: async () => undefined,
    snapshot: async () => snapshot,
    refreshUsage: async () => ({ ok: true, snapshot }),
    ...overrides,
  }
}

function post(app: ReturnType<typeof createAccountPoolRoutes>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("account pool routes", () => {
  test("health is public and minimal", async () => {
    const res = await createAccountPoolRoutes(fakeService()).request("/v1/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test("v1 lease keeps the legacy response shape", async () => {
    const app = createAccountPoolRoutes(fakeService())
    const res = await post(app, "/v1/lease", { workerId: "w1", reason: "prelease" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      accountId: "acc1",
      access: "access-token",
      expiresAt: NOW + 7 * 60 * MINUTE,
    })
  })

  test("v2 lease returns the provider credential bundle", async () => {
    const app = createAccountPoolRoutes(
      fakeService({
        acquire: async () => apiLease,
      }),
    )
    const res = await post(app, "/v1/lease", {
      workerId: "w1",
      reason: "prelease",
      protocolVersion: 2,
      provider: "opencode-go",
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      provider: "opencode-go",
      accountId: "go1",
      access: "go-key",
      expiresAt: NOW + 4 * 60 * MINUTE,
      leaseExpiresAt: NOW + 4 * 60 * MINUTE,
      credential: { type: "api", key: "go-key" },
    })
  })

  test("v2 requires an explicit provider", async () => {
    const app = createAccountPoolRoutes(fakeService())
    const res = await post(app, "/v1/lease", { workerId: "w1", reason: "prelease", protocolVersion: 2 })
    expect(res.status).toBe(400)
  })

  test("v1 rejects provider fields instead of guessing", async () => {
    const app = createAccountPoolRoutes(fakeService())
    const res = await post(app, "/v1/lease", { workerId: "w1", reason: "prelease", provider: "openai" })
    expect(res.status).toBe(400)
  })

  test("unknown providers are rejected", async () => {
    const app = createAccountPoolRoutes(fakeService())
    const res = await post(app, "/v1/lease", {
      workerId: "w1",
      reason: "prelease",
      protocolVersion: 2,
      provider: "nope",
    })
    expect(res.status).toBe(400)
  })

  test("v1 capacity exhaustion maps to 503 while v2 returns at-capacity", async () => {
    const outcome: LeaseOutcome = {
      ok: false,
      failure: { kind: "refused", refused: "at-capacity", error: "account is at capacity" },
    }
    const app = createAccountPoolRoutes(fakeService({ acquire: async () => outcome }))

    const v1 = await post(app, "/v1/lease", { workerId: "w1", reason: "prelease" })
    expect(v1.status).toBe(503)

    const v2 = await post(app, "/v1/lease", {
      workerId: "w1",
      reason: "prelease",
      protocolVersion: 2,
      provider: "anthropic",
    })
    expect(v2.status).toBe(409)
    expect(await v2.json()).toMatchObject({ refused: "at-capacity" })
  })

  test("cooling refusals map to 409 for v1", async () => {
    const outcome: LeaseOutcome = {
      ok: false,
      failure: { kind: "refused", refused: "cooling", error: "account is rate-limited" },
    }
    const app = createAccountPoolRoutes(fakeService({ acquire: async () => outcome }))
    const res = await post(app, "/v1/lease", { workerId: "w1", reason: "prelease" })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ refused: "cooling" })
  })

  test("ratelimit reports are accepted for v1 and v2", async () => {
    const calls: unknown[] = []
    const app = createAccountPoolRoutes(
      fakeService({
        reportLimit: async (report) => {
          calls.push(report)
        },
      }),
    )

    const v1 = await post(app, "/v1/ratelimit", { workerId: "w1", accountId: "acc1", headers: {} })
    expect(v1.status).toBe(204)

    const v2 = await post(app, "/v1/ratelimit", {
      workerId: "w1",
      accountId: "go1",
      protocolVersion: 2,
      provider: "opencode-go",
      resetsAt: NOW + MINUTE,
    })
    expect(v2.status).toBe(204)
    expect(calls).toEqual([
      { workerId: "w1", accountId: "acc1", provider: "anthropic" },
      { workerId: "w1", accountId: "go1", provider: "opencode-go", resetsAt: NOW + MINUTE },
    ])
  })

  test("malformed ratelimit reports are rejected", async () => {
    const app = createAccountPoolRoutes(fakeService())
    const res = await post(app, "/v1/ratelimit", { workerId: "w1" })
    expect(res.status).toBe(400)
  })

  test("usage is provider-scoped", async () => {
    const providers: string[] = []
    const app = createAccountPoolRoutes(
      fakeService({
        snapshot: async (provider) => {
          providers.push(provider)
          return snapshot
        },
      }),
    )
    const res = await app.request("/v1/usage?provider=anthropic")
    expect(res.status).toBe(200)
    expect(providers).toEqual(["anthropic"])

    const unknown = await app.request("/v1/usage?provider=nope")
    expect(unknown.status).toBe(400)
  })

  test("usage refresh throttles with retryAfterMs", async () => {
    const app = createAccountPoolRoutes(
      fakeService({
        refreshUsage: async () => ({ ok: false, retryAfterMs: 12_345 }),
      }),
    )
    const res = await app.request("/v1/usage/refresh", { method: "POST" })
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("13")
    expect(await res.json()).toEqual({ error: "refresh throttled", retryAfterMs: 12_345 })
  })

  test("usage refresh returns the snapshot when allowed", async () => {
    const app = createAccountPoolRoutes(fakeService())
    const res = await app.request("/v1/usage/refresh", { method: "POST" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(snapshot)
  })

  test("GET on the refresh endpoint is rejected", async () => {
    const app = createAccountPoolRoutes(fakeService())
    const res = await app.request("/v1/usage/refresh")
    expect(res.status).toBe(405)
  })

  test("unknown v1 routes return JSON 404 instead of the SPA", async () => {
    const app = createAccountPoolRoutes(fakeService())
    const res = await app.request("/v1/nope")
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "not found" })
  })

  test("malformed lease JSON is rejected", async () => {
    const app = createAccountPoolRoutes(fakeService())
    const res = await app.request("/v1/lease", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    })
    expect(res.status).toBe(400)
  })

  test("providers outside the allowlist are rejected", async () => {
    const app = createAccountPoolRoutes(fakeService(), new Set(["anthropic"]))

    const lease = await post(app, "/v1/lease", {
      workerId: "w1",
      reason: "prelease",
      protocolVersion: 2,
      provider: "openai",
    })
    expect(lease.status).toBe(400)

    const usage = await app.request("/v1/usage?provider=openai")
    expect(usage.status).toBe(400)

    const ratelimit = await post(app, "/v1/ratelimit", {
      workerId: "w1",
      accountId: "acc1",
      protocolVersion: 2,
      provider: "openai",
    })
    expect(ratelimit.status).toBe(400)
  })
})

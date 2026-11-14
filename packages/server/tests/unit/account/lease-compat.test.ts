import { afterEach, describe, expect, test } from "bun:test"
import { type AccountPoolRouteService, createAccountPoolRoutes } from "../../../src/account/routes"
import type { LeaseOutcome } from "../../../src/account/types"
import { createLeaseClient } from "../../../src/lib/lease-client"

const NOW = 1_000_000_000

const lease: LeaseOutcome = {
  ok: true,
  lease: {
    provider: "anthropic",
    accountId: "acc1",
    credential: { type: "oauth", access: "legacy-access", expires: NOW + 3_600_000 },
    leaseExpiresAt: NOW + 3_000_000,
  },
}

const service: AccountPoolRouteService = {
  acquire: async () => lease,
  reportLimit: async () => undefined,
  snapshot: async () => ({ at: NOW, stale: false, accounts: [] }),
  refreshUsage: async () => ({ ok: true, snapshot: { at: NOW, stale: false, accounts: [] } }),
}

let server: { stop: (force?: boolean) => void } | undefined

afterEach(() => {
  server?.stop(true)
  server = undefined
})

describe("existing worker client compatibility", () => {
  test("v1 lease/ratelimit/health work against the master routes", async () => {
    const app = createAccountPoolRoutes(service)
    server = Bun.serve({ port: 0, fetch: app.fetch })

    const client = createLeaseClient(`http://127.0.0.1:${server.port}`, "worker-test")
    expect(await client.healthCheck()).toBe(true)

    const outcome = await client.lease({ reason: "prelease" })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.lease).toEqual({
      accountId: "acc1",
      access: "legacy-access",
      expiresAt: NOW + 3_000_000,
    })

    expect(await client.reportRateLimit({ accountId: "acc1", headers: {} })).toBe(true)
  })
})

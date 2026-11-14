import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAccountPoolScheduler } from "../../../src/account/scheduler"
import { PoolStateStore } from "../../../src/account/state"
import type { PoolCredential } from "../../../src/account/types"
import type { StoredAccount } from "../../../src/lib/auth-files"
import { SENTINEL_REFRESH } from "../../../src/lib/lease-constants"

const HOUR = 60 * 60_000
const MINUTE = 60_000

let tempDir: string | undefined

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "account-pool-"))
  return tempDir
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function account(id: string, provider = "anthropic", overrides: Partial<StoredAccount> = {}): StoredAccount {
  return {
    id,
    label: id,
    refresh: `refresh-${id}`,
    access: `access-${id}`,
    expires: 1_000_000_000 + 8 * HOUR,
    provider,
    ...overrides,
  }
}

function harness(
  accounts: StoredAccount[],
  opts: {
    store?: PoolStateStore
    resolve?: (provider: string, accountId: string) => Promise<PoolCredential>
  } = {},
) {
  let now = 1_000_000_000
  const statePath = join(makeTempDir(), "state.json")
  const store = opts.store ?? new PoolStateStore(statePath)
  const scheduler = createAccountPoolScheduler({
    store,
    listAccounts: async (provider) => accounts.filter((candidate) => (candidate.provider ?? "anthropic") === provider),
    resolveCredential:
      opts.resolve ??
      (async (provider, accountId) => {
        const record = accounts.find((candidate) => candidate.id === accountId)
        if (!record) throw new Error("missing account")
        if (provider === "opencode-go") return { type: "api", key: `key-${accountId}` }
        return { type: "oauth", access: record.access ?? "", expires: record.expires ?? 0 }
      }),
    now: () => now,
  })
  return {
    scheduler,
    store,
    statePath,
    advance: (ms: number) => {
      now += ms
    },
    getNow: () => now,
  }
}

describe("account pool scheduler", () => {
  test("leases the first account and renews the incumbent idempotently", async () => {
    const { scheduler, advance } = harness([account("a"), account("b")])

    const first = await scheduler.acquire({ workerId: "worker-1", reason: "prelease", provider: "anthropic" })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.lease.accountId).toBe("a")
    expect(first.lease.leaseExpiresAt).toBe(1_000_000_000 + 8 * HOUR - 10 * MINUTE)

    advance(30_000)
    const renewal = await scheduler.acquire({
      workerId: "worker-1",
      reason: "prelease",
      provider: "anthropic",
      currentAccountId: "a",
    })
    expect(renewal.ok).toBe(true)
    if (!renewal.ok) return
    expect(renewal.lease.accountId).toBe("a")

    const holders = await scheduler.holders("anthropic", ["a", "b"])
    expect(holders.get("a")).toEqual(["worker-1"])
    expect(holders.get("b")).toEqual([])
  })

  test("enforces holder capacity and allows the incumbent to renew at cap", async () => {
    const { scheduler } = harness([account("a")])

    expect((await scheduler.acquire({ workerId: "w1", reason: "prelease", provider: "anthropic" })).ok).toBe(true)
    expect((await scheduler.acquire({ workerId: "w2", reason: "prelease", provider: "anthropic" })).ok).toBe(true)
    expect((await scheduler.acquire({ workerId: "w3", reason: "prelease", provider: "anthropic" })).ok).toBe(true)

    const fourth = await scheduler.acquire({ workerId: "w4", reason: "prelease", provider: "anthropic" })
    expect(fourth.ok).toBe(false)
    if (fourth.ok) return
    expect(fourth.failure.kind).toBe("no-account")

    const renewal = await scheduler.acquire({
      workerId: "w1",
      reason: "prelease",
      provider: "anthropic",
      currentAccountId: "a",
    })
    expect(renewal.ok).toBe(true)
  })

  test("moves away from a rate-limited account and restores it after cooldown", async () => {
    const { scheduler, advance, getNow } = harness([account("a"), account("b")])

    await scheduler.acquire({ workerId: "w1", reason: "prelease", provider: "anthropic" })
    advance(16_000)
    await scheduler.reportLimit({
      workerId: "w1",
      provider: "anthropic",
      accountId: "a",
      resetsAt: getNow() + HOUR,
    })

    const moved = await scheduler.acquire({
      workerId: "w1",
      reason: "ratelimit",
      provider: "anthropic",
      currentAccountId: "a",
    })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.lease.accountId).toBe("b")

    advance(2 * HOUR)
    const restored = await scheduler.acquire({ workerId: "w2", reason: "prelease", provider: "anthropic" })
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(["a", "b"]).toContain(restored.lease.accountId)
    const cooling = await scheduler.cooling(["a", "b"])
    expect(cooling.has("a")).toBe(false)
  })

  test("ignores a rate-limit report within the adoption grace window", async () => {
    const { scheduler, advance } = harness([account("a"), account("b")])

    await scheduler.acquire({ workerId: "w1", reason: "prelease", provider: "anthropic" })
    await scheduler.reportLimit({ workerId: "w1", provider: "anthropic", accountId: "a" })
    expect((await scheduler.cooling(["a"])).has("a")).toBe(false)

    advance(16_000)
    await scheduler.reportLimit({ workerId: "w1", provider: "anthropic", accountId: "a" })
    expect((await scheduler.cooling(["a"])).has("a")).toBe(true)
  })

  test("handles preferred account prefixes", async () => {
    const accounts = [
      account("aaaa1111"),
      account("aaaa2222"),
      account("bbbb3333", "anthropic", { needsReauth: true }),
      account("cccc4444", "anthropic", { excluded: true }),
    ]
    const { scheduler } = harness(accounts)

    const ambiguous = await scheduler.acquire({
      workerId: "w1",
      reason: "prelease",
      provider: "anthropic",
      preferredAccountIdPrefix: "aaaa",
    })
    expect(ambiguous.ok).toBe(false)
    if (!ambiguous.ok) expect(ambiguous.failure).toMatchObject({ kind: "refused", refused: "ambiguous" })

    const unknown = await scheduler.acquire({
      workerId: "w1",
      reason: "prelease",
      provider: "anthropic",
      preferredAccountIdPrefix: "zzzz",
    })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.failure).toMatchObject({ kind: "refused", refused: "unknown" })

    const reauth = await scheduler.acquire({
      workerId: "w1",
      reason: "prelease",
      provider: "anthropic",
      preferredAccountIdPrefix: "bbbb",
    })
    expect(reauth.ok).toBe(false)
    if (!reauth.ok) expect(reauth.failure).toMatchObject({ kind: "refused", refused: "needs-reauth" })

    const excluded = await scheduler.acquire({
      workerId: "w1",
      reason: "prelease",
      provider: "anthropic",
      preferredAccountIdPrefix: "cccc",
    })
    expect(excluded.ok).toBe(true)
  })

  test("reports at-capacity for a pinned account", async () => {
    const { scheduler } = harness([account("a")])
    await scheduler.acquire({ workerId: "w1", reason: "prelease", provider: "anthropic" })
    await scheduler.acquire({ workerId: "w2", reason: "prelease", provider: "anthropic" })
    await scheduler.acquire({ workerId: "w3", reason: "prelease", provider: "anthropic" })

    const pinned = await scheduler.acquire({
      workerId: "w4",
      reason: "prelease",
      provider: "anthropic",
      preferredAccountIdPrefix: "a",
    })
    expect(pinned.ok).toBe(false)
    if (!pinned.ok) expect(pinned.failure).toMatchObject({ kind: "refused", refused: "at-capacity" })
  })

  test("excludes accounts requested by the worker", async () => {
    const { scheduler } = harness([account("a"), account("b")])
    const result = await scheduler.acquire({
      workerId: "w1",
      reason: "prelease",
      provider: "anthropic",
      excludeAccountIds: ["a"],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lease.accountId).toBe("b")
  })

  test("round-robins across equally loaded accounts", async () => {
    const { scheduler } = harness([account("a"), account("b"), account("c")])
    const first = await scheduler.acquire({ workerId: "w1", reason: "prelease", provider: "anthropic" })
    const second = await scheduler.acquire({ workerId: "w2", reason: "prelease", provider: "anthropic" })
    const third = await scheduler.acquire({ workerId: "w3", reason: "prelease", provider: "anthropic" })
    const fourth = await scheduler.acquire({ workerId: "w4", reason: "prelease", provider: "anthropic" })
    expect([first, second, third, fourth].map((outcome) => (outcome.ok ? outcome.lease.accountId : "fail"))).toEqual([
      "a",
      "b",
      "c",
      "a",
    ])
  })

  test("leases api-key accounts with a ttl", async () => {
    const { scheduler, getNow } = harness([account("go1", "opencode-go", { refresh: "go-key" })])

    const first = await scheduler.acquire({ workerId: "w1", reason: "prelease", provider: "opencode-go" })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.lease.credential).toEqual({ type: "api", key: "key-go1" })
    expect(first.lease.leaseExpiresAt).toBe(getNow() + 4 * HOUR)

    const second = await scheduler.acquire({ workerId: "w2", reason: "prelease", provider: "opencode-go" })
    expect(second.ok).toBe(false)

    const renewal = await scheduler.acquire({
      workerId: "w1",
      reason: "prelease",
      provider: "opencode-go",
      currentAccountId: "go1",
    })
    expect(renewal.ok).toBe(true)
  })

  test("skips accounts that need re-authentication", async () => {
    const { scheduler } = harness([account("a", "anthropic", { needsReauth: true }), account("b")])
    const result = await scheduler.acquire({ workerId: "w1", reason: "prelease", provider: "anthropic" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lease.accountId).toBe("b")
  })

  test("skips accounts carrying a lease sentinel", async () => {
    const { scheduler } = harness([account("a", "anthropic", { refresh: SENTINEL_REFRESH }), account("b")])
    const result = await scheduler.acquire({ workerId: "w1", reason: "prelease", provider: "anthropic" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lease.accountId).toBe("b")

    const pinned = await scheduler.acquire({
      workerId: "w2",
      reason: "prelease",
      provider: "anthropic",
      preferredAccountIdPrefix: "a",
    })
    expect(pinned.ok).toBe(false)
    if (!pinned.ok) expect(pinned.failure).toMatchObject({ kind: "refused", refused: "needs-reauth" })
  })

  test("returns unavailable when credential resolution fails", async () => {
    const { scheduler } = harness([account("a")], {
      resolve: async () => {
        throw new Error("refresh failed")
      },
    })
    const result = await scheduler.acquire({ workerId: "w1", reason: "prelease", provider: "anthropic" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure).toMatchObject({ kind: "unavailable" })
  })

  test("does not issue a lease when state persistence fails", async () => {
    const store = new PoolStateStore("/dev/null/state.json")
    const { scheduler } = harness([account("a")], { store })
    await expect(scheduler.acquire({ workerId: "w1", reason: "prelease", provider: "anthropic" })).rejects.toThrow()
  })
})

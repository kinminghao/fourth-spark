import { beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// account/provider modules resolve HOME/XDG paths at load and hold module-level
// state (usage cache), so each scenario runs the real modules in an isolated
// child process with HOME pointed at a temp dir.
const SRC = join(import.meta.dir, "../../../src")
const mod = (name: string) => JSON.stringify(join(SRC, "lib", name))

const FIXTURE_FLOW = `
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const home = process.env.HOME
const xdg = process.env.XDG_DATA_HOME
const authPath = join(xdg, "opencode", "auth.json")
const accountsPath = join(home, ".config", "opencode", "claude-accounts.json")
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"))

const USAGE_JSON = {
  usage: {
    rolling: { status: "ok", percent: 9, resetsAt: "2026-10-18T05:20:38.000Z" },
    weekly: { status: "ok", percent: 10, resetsAt: "2026-10-19T00:00:00.000Z" },
    monthly: { status: "ok", percent: 5, resetsAt: "2026-11-16T15:45:49.000Z" },
  },
}

globalThis.fetch = async (url, opts) => {
  const u = String(url)
  const key = (opts && opts.headers && opts.headers.Authorization ? opts.headers.Authorization : "").replace("Bearer ", "")
  if (u.includes("/inference/go/v1/models")) {
    if (key.startsWith("oc_sk_good")) return new Response(JSON.stringify({ data: [] }), { status: 200 })
    return new Response(JSON.stringify({ error: { type: "server_error", message: "Invalid credential" } }), { status: 401 })
  }
  if (u.includes("/zen/go/v1/usage")) return new Response(JSON.stringify(USAGE_JSON), { status: 200 })
  throw new Error("unexpected fetch: " + u)
}

mkdirSync(join(home, ".config", "opencode"), { recursive: true })
mkdirSync(join(xdg, "opencode"), { recursive: true })

const seedAnthropicAccount = { id: "acc-anthropic", label: "Claude A", refresh: "rA", access: "aA", expires: Date.now() + 3600_000 }
writeFileSync(accountsPath, JSON.stringify({ version: 1, activeIds: { anthropic: "acc-anthropic" }, accounts: [seedAnthropicAccount] }, null, 2))
const seedAnthropicAuth = { type: "oauth", access: "aA", refresh: "rA", expires: 111 }
writeFileSync(authPath, JSON.stringify({ anthropic: seedAnthropicAuth }, null, 2))

const { addApiKeyAccount } = await import(${mod("api-key-onboard")})
const { collectUsage } = await import(${mod("claude-usage")})
const { switchToAccount } = await import(${mod("account-switcher")})
const { removeAccount } = await import(${mod("claude-onboard")})

const result = {}

const add1 = await addApiKeyAccount("opencode-go", "oc_sk_good_1")
const accountsAfterAdd1 = readJson(accountsPath)
const authAfterAdd1 = readJson(authPath)
const rec1 = accountsAfterAdd1.accounts.find((a) => a.id === add1.id)
result.add1 = add1
result.add1Record = { provider: rec1 ? rec1.provider : null, refresh: rec1 ? rec1.refresh : null, access: rec1 ? rec1.access : null }
result.add1Active = accountsAfterAdd1.activeIds["opencode-go"] || null
result.add1Auth = authAfterAdd1["opencode-go"] || null

const usage = await collectUsage("opencode-go")
const usageAcct = usage.accounts.find((a) => a.id === add1.id)
result.usage = {
  count: usage.accounts.length,
  active: usageAcct ? usageAcct.active : null,
  fiveHour: usageAcct && usageAcct.usage ? usageAcct.usage.five_hour || null : null,
  sevenDay: usageAcct && usageAcct.usage ? usageAcct.usage.seven_day || null : null,
  monthly: usageAcct && usageAcct.usage ? usageAcct.usage.monthly || null : null,
}

const add2 = await addApiKeyAccount("opencode-go", "oc_sk_good_2")

// Real switch away from add2, then simulate an external write of a foreign key,
// then switch back. Api-key switching must not adopt that foreign key.
await switchToAccount("opencode-go", add1.id)
const authBeforeForeign = readJson(authPath)
authBeforeForeign["opencode-go"] = { type: "api", key: "oc_sk_foreign_0000" }
writeFileSync(authPath, JSON.stringify(authBeforeForeign, null, 2))
await switchToAccount("opencode-go", add2.id)

const accountsAfterSwitch = readJson(accountsPath)
const authAfterSwitch = readJson(authPath)
result.switch = {
  add2id: add2.id,
  activeId: accountsAfterSwitch.activeIds["opencode-go"] || null,
  authKey: authAfterSwitch["opencode-go"] || null,
  goAccountCount: accountsAfterSwitch.accounts.filter((a) => a.provider === "opencode-go").length,
}
result.foreignGuard = {
  authKey: authAfterSwitch["opencode-go"] || null,
  add1Refresh: accountsAfterSwitch.accounts.find((a) => a.id === add1.id)?.refresh ?? null,
  activeId: accountsAfterSwitch.activeIds["opencode-go"] || null,
}

const usageAfterAdds = await collectUsage("opencode-go")
result.usageAfterAdds = {
  count: usageAfterAdds.accounts.length,
  ids: usageAfterAdds.accounts.map((a) => a.id),
}

const removed = await removeAccount(add2.id)
const accountsAfterRemove = readJson(accountsPath)
const authAfterRemove = readJson(authPath)
result.remove = {
  ok: removed.ok,
  reason: removed.ok ? null : removed.reason,
  goEntry: authAfterRemove["opencode-go"] || null,
  anthropicEntry: authAfterRemove.anthropic || null,
  accountGone: !accountsAfterRemove.accounts.some((a) => a.id === add2.id),
  activeIdsGo: accountsAfterRemove.activeIds["opencode-go"] || null,
}

const usageAfterRemove = await collectUsage("opencode-go")
result.usageAfterRemove = {
  count: usageAfterRemove.accounts.length,
  ids: usageAfterRemove.accounts.map((a) => a.id),
}

const add3 = await addApiKeyAccount("opencode-go", "  oc_sk_good_3  ")
const accountsAfterAdd3 = readJson(accountsPath)
const authAfterAdd3 = readJson(authPath)
const rec3 = accountsAfterAdd3.accounts.find((a) => a.id === add3.id)
result.add3 = add3
result.add3Record = { provider: rec3 ? rec3.provider : null, refresh: rec3 ? rec3.refresh : null, access: rec3 ? rec3.access : null }
result.add3Auth = authAfterAdd3["opencode-go"] || null

const beforeAccounts = readFileSync(accountsPath, "utf8")
const beforeAuth = readFileSync(authPath, "utf8")
const badAdd = await addApiKeyAccount("opencode-go", "oc_sk_bad")
result.badAdd = badAdd
result.badNoChange = readFileSync(accountsPath, "utf8") === beforeAccounts && readFileSync(authPath, "utf8") === beforeAuth

const finalAccounts = readJson(accountsPath)
const finalAuth = readJson(authPath)
result.finalAnthropicAccount = finalAccounts.accounts.find((a) => a.id === "acc-anthropic") || null
result.finalAnthropicAuth = finalAuth.anthropic || null
result.seedAnthropicAccount = seedAnthropicAccount
result.seedAnthropicAuth = seedAnthropicAuth

console.log("FIXTURE_RESULT:" + JSON.stringify(result))
`

const FIXTURE_DEGRADATION = `
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const home = process.env.HOME
const xdg = process.env.XDG_DATA_HOME
const accountsPath = join(home, ".config", "opencode", "claude-accounts.json")
const authPath = join(xdg, "opencode", "auth.json")

globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.includes("/inference/go/v1/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 })
  if (u.includes("/zen/go/v1/usage")) return new Response("boom", { status: 500 })
  throw new Error("unexpected fetch: " + u)
}

mkdirSync(join(home, ".config", "opencode"), { recursive: true })
mkdirSync(join(xdg, "opencode"), { recursive: true })
writeFileSync(accountsPath, JSON.stringify({ version: 1, activeIds: {}, accounts: [] }, null, 2))
writeFileSync(authPath, JSON.stringify({}, null, 2))

const { addApiKeyAccount } = await import(${mod("api-key-onboard")})
const { collectUsage } = await import(${mod("claude-usage")})

const add = await addApiKeyAccount("opencode-go", "oc_sk_good_1")
const usage = await collectUsage("opencode-go")
const account = usage.accounts[0]
console.log("FIXTURE_RESULT:" + JSON.stringify({
  addOk: add.ok,
  accountCount: usage.accounts.length,
  accountError: account ? account.error || null : null,
  accountUsage: account && account.usage ? account.usage : null,
}))
`

const FIXTURE_MALFORMED = `
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const home = process.env.HOME
const xdg = process.env.XDG_DATA_HOME
const accountsPath = join(home, ".config", "opencode", "claude-accounts.json")
const authPath = join(xdg, "opencode", "auth.json")

globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.includes("/inference/go/v1/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 })
  if (u.includes("/zen/go/v1/usage")) return new Response("not json", { status: 200 })
  throw new Error("unexpected fetch: " + u)
}

mkdirSync(join(home, ".config", "opencode"), { recursive: true })
mkdirSync(join(xdg, "opencode"), { recursive: true })
writeFileSync(accountsPath, JSON.stringify({ version: 1, activeIds: {}, accounts: [] }, null, 2))
writeFileSync(authPath, JSON.stringify({}, null, 2))

const { addApiKeyAccount } = await import(${mod("api-key-onboard")})
const { collectUsage } = await import(${mod("claude-usage")})

const add = await addApiKeyAccount("opencode-go", "oc_sk_good_1")
const usage = await collectUsage("opencode-go")
const account = usage.accounts[0]
console.log("FIXTURE_RESULT:" + JSON.stringify({
  addOk: add.ok,
  accountCount: usage.accounts.length,
  accountError: account ? account.error || null : null,
  accountUsage: account && account.usage ? account.usage : null,
}))
`

const FIXTURE_WORKER = `
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const home = process.env.HOME
const xdg = process.env.XDG_DATA_HOME
const accountsPath = join(home, ".config", "opencode", "claude-accounts.json")
const authPath = join(xdg, "opencode", "auth.json")

globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.includes("/inference/go/v1/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 })
  if (u.includes("/zen/go/v1/usage"))
    return new Response(JSON.stringify({ usage: { rolling: { status: "ok", percent: 9 } } }), { status: 200 })
  throw new Error("unexpected fetch: " + u)
}

mkdirSync(join(home, ".config", "opencode"), { recursive: true })
mkdirSync(join(xdg, "opencode"), { recursive: true })
writeFileSync(
  accountsPath,
  JSON.stringify(
    {
      version: 1,
      activeIds: { anthropic: "acc-a" },
      accounts: [{ id: "acc-a", label: "A", refresh: "rA", access: "aA", expires: Date.now() + 3600_000 }],
    },
    null,
    2,
  ),
)
writeFileSync(authPath, JSON.stringify({}, null, 2))

const { initWorkerConfig, isWorkerMode } = await import(${mod("config")})
await initWorkerConfig(async (key) => (key === "cloud_master_url" ? "http://127.0.0.1:9" : "fixture-worker"))

const { addApiKeyAccount } = await import(${mod("api-key-onboard")})
const { collectUsage } = await import(${mod("claude-usage")})
const { removeAccount } = await import(${mod("claude-onboard")})

const result = { isWorker: isWorkerMode() }
const add = await addApiKeyAccount("opencode-go", "oc_sk_good_w1")
result.addOk = add.ok
const usage = await collectUsage("opencode-go")
result.usageCount = usage.accounts.length
result.usageIds = usage.accounts.map((a) => a.id)
result.anthropicRemove = await removeAccount("acc-a")
console.log("FIXTURE_RESULT:" + JSON.stringify(result))
`

type WindowResult = { utilization: number; resets_at?: string } | null

interface FlowResult {
  add1: { ok: boolean; id?: string; label?: string; reason?: string }
  add1Record: { provider: string | null; refresh: string | null; access: string | null }
  add1Active: string | null
  add1Auth: { type: string; key: string } | null
  usage: {
    count: number
    active: boolean | null
    fiveHour: WindowResult
    sevenDay: WindowResult
    monthly: WindowResult
  }
  switch: {
    add2id: string
    activeId: string | null
    authKey: { type: string; key: string } | null
    goAccountCount: number
  }
  foreignGuard: { authKey: { type: string; key: string } | null; add1Refresh: string | null; activeId: string | null }
  usageAfterAdds: { count: number; ids: string[] }
  usageAfterRemove: { count: number; ids: string[] }
  remove: {
    ok: boolean
    reason: string | null
    goEntry: unknown
    anthropicEntry: { type: string; access: string; refresh: string; expires: number } | null
    accountGone: boolean
    activeIdsGo: string | null
  }
  add3: { ok: boolean; id?: string; label?: string; reason?: string }
  add3Record: { provider: string | null; refresh: string | null; access: string | null }
  add3Auth: { type: string; key: string } | null
  badAdd: { ok: boolean; reason?: string }
  badNoChange: boolean
  finalAnthropicAccount: { id: string; label: string; refresh: string; access?: string; expires?: number } | null
  finalAnthropicAuth: { type: string; access: string; refresh: string; expires: number } | null
  seedAnthropicAccount: { id: string; label: string; refresh: string; access?: string; expires?: number }
  seedAnthropicAuth: { type: string; access: string; refresh: string; expires: number }
}

interface DegradationResult {
  addOk: boolean
  accountCount: number
  accountError: string | null
  accountUsage: unknown
}

interface WorkerResult {
  isWorker: boolean
  addOk: boolean
  usageCount: number
  usageIds: string[]
  anthropicRemove: { ok: boolean; reason?: string }
}

function runFixture(source: string, tag: string): Record<string, unknown> {
  const workDir = mkdtempSync(join(tmpdir(), `opencode-go-${tag}-`))
  const home = join(workDir, "home")
  const xdg = join(workDir, "xdg")
  mkdirSync(home, { recursive: true })
  mkdirSync(xdg, { recursive: true })
  const scriptPath = join(workDir, "fixture.ts")
  writeFileSync(scriptPath, source)
  try {
    const proc = Bun.spawnSync([process.execPath, scriptPath], {
      cwd: join(SRC, ".."),
      env: { ...process.env, HOME: home, XDG_DATA_HOME: xdg },
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = proc.stdout.toString()
    const line = stdout.split("\n").find((l) => l.startsWith("FIXTURE_RESULT:"))
    if (!proc.success || !line) {
      throw new Error(
        `fixture ${tag} failed (exit ${proc.exitCode})\nstdout:\n${stdout}\nstderr:\n${proc.stderr.toString()}`,
      )
    }
    return JSON.parse(line.slice("FIXTURE_RESULT:".length)) as Record<string, unknown>
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16)
}

describe("opencode-go api-key flow (isolated child process)", () => {
  let result: FlowResult
  beforeAll(() => {
    result = runFixture(FIXTURE_FLOW, "flow") as unknown as FlowResult
  })

  test("adds an api-key account and stamps the record + auth.json entry", () => {
    expect(result.add1.ok).toBe(true)
    expect(result.add1.id).toBe(hashKey("oc_sk_good_1"))
    expect(result.add1.label).toContain("OpenCode Go")
    expect(result.add1.label?.endsWith("1")).toBe(true)
    expect(result.add1Record).toEqual({
      provider: "opencode-go",
      refresh: "oc_sk_good_1",
      access: "oc_sk_good_1",
    })
    expect(result.add1Active).toBe(result.add1.id)
    expect(result.add1Auth).toEqual({ type: "api", key: "oc_sk_good_1" })
  })

  test("collectUsage maps rolling/weekly/monthly windows", () => {
    expect(result.usage.count).toBe(1)
    expect(result.usage.active).toBe(true)
    expect(result.usage.fiveHour).toEqual({ utilization: 9, resets_at: "2026-10-18T05:20:38.000Z" })
    expect(result.usage.sevenDay).toEqual({ utilization: 10, resets_at: "2026-10-19T00:00:00.000Z" })
    expect(result.usage.monthly).toEqual({ utilization: 5, resets_at: "2026-11-16T15:45:49.000Z" })
  })

  test("adds a second key and switches the active account", () => {
    expect(result.switch.activeId).toBe(result.switch.add2id)
    expect(result.switch.authKey).toEqual({ type: "api", key: "oc_sk_good_2" })
    expect(result.switch.goAccountCount).toBe(2)
  })

  test("api-key switch never adopts a foreign live key for the outgoing record", () => {
    expect(result.foreignGuard.authKey).toEqual({ type: "api", key: "oc_sk_good_2" })
    expect(result.foreignGuard.add1Refresh).toBe("oc_sk_good_1")
    expect(result.foreignGuard.activeId).toBe(result.switch.add2id)
  })

  test("removing the active api-key account clears the auth entry but keeps anthropic", () => {
    expect(result.remove.ok).toBe(true)
    expect(result.remove.goEntry).toBeNull()
    expect(result.remove.accountGone).toBe(true)
    expect(result.remove.activeIdsGo).toBeNull()
    expect(result.remove.anthropicEntry).toEqual(result.seedAnthropicAuth)
  })

  test("adding and removing accounts invalidates the usage cache", () => {
    expect(result.usageAfterAdds).toEqual({ count: 2, ids: [hashKey("oc_sk_good_1"), hashKey("oc_sk_good_2")] })
    expect(result.usageAfterRemove).toEqual({ count: 1, ids: [hashKey("oc_sk_good_1")] })
  })

  test("normalizes a pasted key before storing it", () => {
    expect(result.add3.ok).toBe(true)
    expect(result.add3.id).toBe(hashKey("oc_sk_good_3"))
    expect(result.add3.label?.endsWith("3")).toBe(true)
    expect(result.add3Record).toEqual({
      provider: "opencode-go",
      refresh: "oc_sk_good_3",
      access: "oc_sk_good_3",
    })
    expect(result.add3Auth).toEqual({ type: "api", key: "oc_sk_good_3" })
  })

  test("an invalid key is rejected without touching either file", () => {
    expect(result.badAdd).toEqual({ ok: false, reason: "invalid-key" })
    expect(result.badNoChange).toBe(true)
  })

  test("the seeded anthropic account and entry are untouched", () => {
    expect(result.finalAnthropicAccount).toEqual(result.seedAnthropicAccount)
    expect(result.finalAnthropicAuth).toEqual(result.seedAnthropicAuth)
  })
})

describe("opencode-go usage degradation (isolated child process)", () => {
  let result: DegradationResult

  beforeAll(() => {
    result = runFixture(FIXTURE_DEGRADATION, "degrade") as unknown as DegradationResult
  })

  test("a failing usage endpoint surfaces an error instead of throwing", () => {
    expect(result.addOk).toBe(true)
    expect(result.accountCount).toBe(1)
    expect(result.accountError).toContain("usage request failed (500)")
    expect(result.accountUsage).toBeNull()
  })
})

describe("opencode-go malformed usage response (isolated child process)", () => {
  let result: DegradationResult

  beforeAll(() => {
    result = runFixture(FIXTURE_MALFORMED, "malformed") as unknown as DegradationResult
  })

  test("invalid JSON surfaces an error instead of empty usage", () => {
    expect(result.addOk).toBe(true)
    expect(result.accountCount).toBe(1)
    expect(result.accountError).toContain("not valid JSON")
    expect(result.accountUsage).toBeNull()
  })
})

describe("opencode-go in worker mode (isolated child process)", () => {
  let result: WorkerResult

  beforeAll(() => {
    result = runFixture(FIXTURE_WORKER, "worker") as unknown as WorkerResult
  })

  test("machine-local providers stay fully available while the pool manages the default provider", () => {
    expect(result.isWorker).toBe(true)
    expect(result.addOk).toBe(true)
    expect(result.usageCount).toBe(1)
    expect(result.usageIds).toEqual([hashKey("oc_sk_good_w1")])
  })

  test("worker mode still protects the default provider's accounts from removal", () => {
    expect(result.anthropicRemove).toEqual({ ok: false, reason: "account removal is not available in worker mode" })
  })
})

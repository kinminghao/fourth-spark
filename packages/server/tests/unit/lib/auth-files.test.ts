import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// auth-files resolves HOME/XDG paths when its module is first loaded, and the
// bun test runner shares one module registry across files, so this suite runs
// the real modules in an isolated child process with HOME pointed at a temp dir.
const SRC = join(import.meta.dir, "../../../src")
const workDir = mkdtempSync(join(tmpdir(), "auth-files-test-"))
const home = join(workDir, "home")
const xdg = join(workDir, "xdg")

const FIXTURE = `
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  loadAccounts,
  readAuthAnthropic,
  readAuthEntry,
  saveAccounts,
  writeAuthAnthropic,
  writeAuthEntry,
} from ${JSON.stringify(join(SRC, "lib/auth-files"))}
import { switchToAccount } from ${JSON.stringify(join(SRC, "lib/account-switcher"))}
import { writeLease } from ${JSON.stringify(join(SRC, "lib/lease-writer"))}
import { removeAccount } from ${JSON.stringify(join(SRC, "lib/claude-onboard"))}

const home = process.env.HOME
const xdg = process.env.XDG_DATA_HOME
const authPath = join(xdg, "opencode", "auth.json")
const accountsPath = join(home, ".config", "opencode", "claude-accounts.json")
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"))

const result = {}

await writeAuthEntry("anthropic", { kind: "full", refresh: "r1", access: "a1", expires: 111 })
const expectedBytes = JSON.stringify({ anthropic: { type: "oauth", access: "a1", refresh: "r1", expires: 111 } }, null, 2)
result.expectedByteEqual = readFileSync(authPath, "utf8") === expectedBytes

await writeAuthAnthropic({ refresh: "r1", access: "a1", expires: 111 })
result.wrapperBareByteEqual = readFileSync(authPath, "utf8") === expectedBytes

result.entryRead = await readAuthEntry("anthropic")
result.anthropicRead = await readAuthAnthropic()
result.missingEntry = (await readAuthEntry("does-not-exist")) ?? null

mkdirSync(join(home, ".config", "opencode"), { recursive: true })
writeFileSync(
  accountsPath,
  JSON.stringify({
    version: 1,
    activeId: "acc-a",
    openaiActiveId: "acc-b",
    accounts: [
      { id: "acc-a", label: "A", refresh: "rA" },
      { id: "acc-b", label: "B", refresh: "rB", provider: "openai" },
    ],
  }),
)
const migrated = await loadAccounts()
result.migration = migrated.activeIds

writeFileSync(accountsPath, JSON.stringify({ version: 1, activeId: "acc-old", activeIds: { anthropic: "acc-new" }, accounts: [] }))
result.newWins = (await loadAccounts()).activeIds

await saveAccounts(migrated)
const saved = readJson(accountsPath)
result.savedShape = {
  activeIds: saved.activeIds,
  hasActiveId: "activeId" in saved,
  hasOpenaiActiveId: "openaiActiveId" in saved,
}

const future = Date.now() + 3600_000
writeFileSync(
  accountsPath,
  JSON.stringify({
    version: 1,
    activeIds: { anthropic: "acc-a" },
    accounts: [
      { id: "acc-a", label: "A", refresh: "rA", access: "aA-live", expires: future },
      { id: "acc-b", label: "B", refresh: "rB", access: "aB", expires: future },
    ],
  }),
)
writeFileSync(authPath, JSON.stringify({ anthropic: { type: "oauth", access: "aA-live", refresh: "rA", expires: future } }))

const switched = await switchToAccount("anthropic", "acc-b")
const afterAccounts = readJson(accountsPath)
const afterAuth = readJson(authPath)
result.switch = {
  returnedId: switched.id,
  activeIdAfter: afterAccounts.activeIds.anthropic,
  outgoingRefresh: afterAccounts.accounts.find((a) => a.id === "acc-a").refresh,
  outgoingAccess: afterAccounts.accounts.find((a) => a.id === "acc-a").access,
  authAccess: afterAuth.anthropic.access,
  authRefresh: afterAuth.anthropic.refresh,
}

try {
  await switchToAccount("openai", "acc-a")
  result.mismatchError = null
} catch (err) {
  result.mismatchError = String(err.message)
}

await writeLease({ access: "lease-access", expires: future, accountId: "acc-leased" })
const afterLeaseAuth = readJson(authPath)
const afterLeaseAccounts = readJson(accountsPath)
result.lease = {
  entryRefresh: afterLeaseAuth.anthropic.refresh,
  entryAccess: afterLeaseAuth.anthropic.access,
  activeId: afterLeaseAccounts.activeIds.anthropic,
}

writeFileSync(
  accountsPath,
  JSON.stringify({
    version: 1,
    activeId: "acc-a",
    openaiActiveId: "acc-o",
    accounts: [
      { id: "acc-a", label: "A", refresh: "rA" },
      { id: "acc-o", label: "O", refresh: "rO", provider: "openai" },
    ],
  }),
)
result.removeActive = await removeAccount("acc-o")

console.log("FIXTURE_RESULT:" + JSON.stringify(result))
`

type FixtureResult = {
  expectedByteEqual: boolean
  wrapperBareByteEqual: boolean
  entryRead: { access?: string; refresh?: string; expires?: number } | null
  anthropicRead: { access?: string; refresh?: string; expires?: number } | null
  missingEntry: unknown
  migration: Record<string, string>
  newWins: Record<string, string>
  savedShape: { activeIds: Record<string, string>; hasActiveId: boolean; hasOpenaiActiveId: boolean }
  switch: {
    returnedId: string
    activeIdAfter: string
    outgoingRefresh: string
    outgoingAccess: string
    authAccess: string
    authRefresh: string
  }
  mismatchError: string | null
  lease: { entryRefresh: string; entryAccess: string; activeId: string }
  removeActive: { ok: true; label: string } | { ok: false; reason: string }
}

let result: FixtureResult

describe("auth-files and account switching in an isolated process", () => {
  beforeAll(() => {
    mkdirSync(home, { recursive: true })
    mkdirSync(xdg, { recursive: true })
    const scriptPath = join(workDir, "fixture.ts")
    writeFileSync(scriptPath, FIXTURE)
    const proc = Bun.spawnSync([process.execPath, scriptPath], {
      cwd: join(SRC, ".."),
      env: { ...process.env, HOME: home, XDG_DATA_HOME: xdg },
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = proc.stdout.toString()
    const line = stdout.split("\n").find((l) => l.startsWith("FIXTURE_RESULT:"))
    if (!proc.success || !line) {
      throw new Error(`fixture failed (exit ${proc.exitCode})\nstdout:\n${stdout}\nstderr:\n${proc.stderr.toString()}`)
    }
    result = JSON.parse(line.slice("FIXTURE_RESULT:".length)) as FixtureResult
  })

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  test("writeAuthEntry for anthropic matches the legacy auth.json bytes", () => {
    expect(result.expectedByteEqual).toBe(true)
    expect(result.wrapperBareByteEqual).toBe(true)
  })

  test("readAuthEntry reads the anthropic entry and ignores missing keys", () => {
    expect(result.entryRead).toEqual({ access: "a1", refresh: "r1", expires: 111 })
    expect(result.anthropicRead).toEqual({ access: "a1", refresh: "r1", expires: 111 })
    expect(result.missingEntry).toBeNull()
  })

  test("loadAccounts migrates legacy activeId fields into activeIds", () => {
    expect(result.migration).toEqual({ anthropic: "acc-a", openai: "acc-b" })
  })

  test("activeIds override legacy fields when both are present", () => {
    expect(result.newWins).toEqual({ anthropic: "acc-new" })
  })

  test("saveAccounts writes the activeIds shape without legacy fields", () => {
    expect(result.savedShape.activeIds).toEqual({ anthropic: "acc-a", openai: "acc-b" })
    expect(result.savedShape.hasActiveId).toBe(false)
    expect(result.savedShape.hasOpenaiActiveId).toBe(false)
  })

  test("switchToAccount captures the outgoing token and writes the target token", () => {
    expect(result.switch.returnedId).toBe("acc-b")
    expect(result.switch.activeIdAfter).toBe("acc-b")
    expect(result.switch.outgoingRefresh).toBe("rA")
    expect(result.switch.outgoingAccess).toBe("aA-live")
    expect(result.switch.authAccess).toBe("aB")
    expect(result.switch.authRefresh).toBe("rB")
  })

  test("switchToAccount rejects accounts of a different provider", () => {
    expect(result.mismatchError).toBe("该账号与目标 provider 不一致,拒绝写入 Claude 登录态")
  })

  test("writeLease writes the sentinel refresh and records the leased active id", () => {
    expect(result.lease.entryRefresh).toBe("claude-accounts-pool/cloud-lease/not-a-refresh-token")
    expect(result.lease.entryAccess).toBe("lease-access")
    expect(result.lease.activeId).toBe("acc-leased")
  })

  test("removeAccount protects the active account of any migrated provider", () => {
    expect(result.removeActive).toEqual({ ok: false, reason: "cannot remove active account" })
  })
})

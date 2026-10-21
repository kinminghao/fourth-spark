import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// openai.ts, auth-files.ts and the account modules resolve HOME/XDG at import
// time and hold module-level login state, so the flow runs in an isolated
// child process with HOME pointed at a temp dir (same pattern as
// auth-files.test.ts).
const SRC = join(import.meta.dir, "../../../src")
const modulePath = (name: string) => JSON.stringify(join(SRC, "lib", name))

const FIXTURE = `
import { createServer } from "node:net"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { cancelOpenAiLogin, startOpenAiLogin, pollOpenAiLogin, refreshOpenAiToken } from ${modulePath("account-providers/openai")}
import { switchToAccount } from ${modulePath("account-switcher")}
import { removeAccount } from ${modulePath("claude-onboard")}
import { runtimeManager } from ${modulePath("process-manager")}

const home = process.env.HOME
const xdg = process.env.XDG_DATA_HOME
const authPath = join(xdg, "opencode", "auth.json")
const accountsPath = join(home, ".config", "opencode", "claude-accounts.json")
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))

// Seed empty stores so auth-files resolves the temp XDG path deterministically.
writeFileSync(authPath, JSON.stringify({}, null, 2))
writeFileSync(accountsPath, JSON.stringify({ version: 1, activeIds: {}, accounts: [] }, null, 2))

const refreshState = { count: 0 }
runtimeManager.registerProvider({
  id: "test-account-store",
  credentialChannel: "account-store",
  refreshCredentials: async () => {
    refreshState.count += 1
  },
  credentialWriter: {
    read: async () => undefined,
    write: async () => {},
  },
  initialize: async () => {},
  teardown: async () => {},
  isReady: () => false,
  getClient: () => null,
  healthCheck: async () => ({ reachable: false }),
  injectMcp: () => {},
  removeMcp: () => {},
  killAllSync: () => {},
})

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url")
const fakeJwt = (payload) => b64({ alg: "none" }) + "." + b64(payload) + ".sig"
const claimsFor = (email, accountId) => ({
  email,
  chatgpt_account_id: accountId,
  organizations: [{ id: "org-" + accountId }],
})

const TOKEN_URL = "https://auth.openai.com/oauth/token"
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (url !== TOKEN_URL) return realFetch(input, init)

  const body = new URLSearchParams(typeof init?.body === "string" ? init.body : "")
  const grant = body.get("grant_type")
  if (grant === "authorization_code") {
    const code = body.get("code")
    let token = null
    if (code === "code-one") {
      token = {
        access_token: "access-one",
        refresh_token: "refresh-one",
        expires_in: 3600,
        id_token: fakeJwt(claimsFor("one@example.com", "acct-one")),
      }
    } else if (code === "code-two") {
      token = {
        access_token: "access-two",
        refresh_token: "refresh-two",
        expires_in: 3600,
        id_token: fakeJwt(claimsFor("two@example.com", "acct-two")),
      }
    }
    if (!token) return new Response("unknown code", { status: 400 })
    return new Response(JSON.stringify(token), { status: 200, headers: { "Content-Type": "application/json" } })
  }
  if (grant === "refresh_token") {
    return new Response(
      JSON.stringify({
        access_token: "access-refreshed",
        refresh_token: "refresh-refreshed",
        expires_in: 3600,
        id_token: fakeJwt(claimsFor("one@example.com", "acct-one")),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }
  return new Response("unsupported grant", { status: 400 })
}

const openAiAccounts = () => readJson(accountsPath).accounts.filter((account) => account.provider === "openai")
const callbackUrl = (port, query) => "http://127.0.0.1:" + port + "/auth/callback?" + query
const result = {}

// A. authorize URL shape
const first = await startOpenAiLogin(0)
const firstUrl = new URL(first.url)
const firstPort = Number(new URL(firstUrl.searchParams.get("redirect_uri")).port)
const firstState = firstUrl.searchParams.get("state")
result.authorize = {
  host: firstUrl.host,
  pathname: firstUrl.pathname,
  clientId: firstUrl.searchParams.get("client_id"),
  responseType: firstUrl.searchParams.get("response_type"),
  scope: firstUrl.searchParams.get("scope"),
  codeChallengeMethod: firstUrl.searchParams.get("code_challenge_method"),
  codeChallengeLength: (firstUrl.searchParams.get("code_challenge") || "").length,
  state: firstState,
  idTokenAddOrganizations: firstUrl.searchParams.get("id_token_add_organizations"),
  codexCliSimplifiedFlow: firstUrl.searchParams.get("codex_cli_simplified_flow"),
  originator: firstUrl.searchParams.get("originator"),
  redirectUri: firstUrl.searchParams.get("redirect_uri"),
  callbackPort: firstPort,
}

// B. idempotent start while a login is pending
const secondStart = await startOpenAiLogin(0)
result.idempotent = {
  samePendingId: secondStart.pendingId === first.pendingId,
  sameUrl: secondStart.url === first.url,
  sameExpiresAt: secondStart.expiresAt === first.expiresAt,
}

// C. wrong state is rejected and leaves the pending login untouched
const wrongState = await fetch(callbackUrl(firstPort, "code=code-one&state=wrong"))
result.wrongState = {
  status: wrongState.status,
  poll: (await pollOpenAiLogin(first.pendingId)) ?? null,
}

// D. correct callback exchanges the code, persists accountId and completes once
const firstCallback = await fetch(
  callbackUrl(firstPort, "code=code-one&state=" + encodeURIComponent(firstState)),
)
const firstPoll = await pollOpenAiLogin(first.pendingId)
const firstPollAgain = await pollOpenAiLogin(first.pendingId)
const authAfterFirst = readJson(authPath)
const accountsAfterFirst = readJson(accountsPath)
const firstEntry = authAfterFirst.openai || null
result.callbackOne = {
  status: firstCallback.status,
  poll: firstPoll ?? null,
  pollAgain: firstPollAgain ?? null,
  authEntry: firstEntry,
  authKeys: firstEntry ? Object.keys(firstEntry) : [],
  expiresIsFuture:
    firstEntry && typeof firstEntry.expires === "number" ? firstEntry.expires > Date.now() : false,
  activeId: accountsAfterFirst.activeIds.openai ?? null,
  accounts: accountsAfterFirst.accounts
    .filter((account) => account.provider === "openai")
    .map((account) => ({ provider: account.provider, accountId: account.accountId, label: account.label })),
}

// E. a completed login does not block starting the next one
const thirdStart = await startOpenAiLogin(0)
const thirdUrl = new URL(thirdStart.url)
const thirdPort = Number(new URL(thirdUrl.searchParams.get("redirect_uri")).port)
const thirdState = thirdUrl.searchParams.get("state")
const secondCallback = await fetch(
  callbackUrl(thirdPort, "code=code-two&state=" + encodeURIComponent(thirdState)),
)
const secondPoll = await pollOpenAiLogin(thirdStart.pendingId)
const authAfterSecond = readJson(authPath)
const accountsAfterSecond = readJson(accountsPath)
result.callbackTwo = {
  status: secondCallback.status,
  poll: secondPoll ?? null,
  newPendingId: thirdStart.pendingId !== first.pendingId,
  authAccountId: authAfterSecond.openai ? authAfterSecond.openai.accountId : null,
  activeId: accountsAfterSecond.activeIds.openai ?? null,
  openAiAccountCount: accountsAfterSecond.accounts.filter((account) => account.provider === "openai").length,
}

// F. switching disposes account-store runtimes once
const beforeSwitch = refreshState.count
const switched = await switchToAccount("openai", "acct-one")
const authAfterSwitch = readJson(authPath)
const accountsAfterSwitch = readJson(accountsPath)
result.switch = {
  returnedId: switched.id,
  access: authAfterSwitch.openai ? authAfterSwitch.openai.access : null,
  accountId: authAfterSwitch.openai ? authAfterSwitch.openai.accountId : null,
  activeId: accountsAfterSwitch.activeIds.openai ?? null,
  refreshDelta: refreshState.count - beforeSwitch,
}

// G. deleting an inactive account does not dispose runtimes
const beforeInactiveRemove = refreshState.count
const removedInactive = await removeAccount("acct-two")
const accountsAfterInactive = readJson(accountsPath)
result.removeInactive = {
  result: removedInactive,
  refreshDelta: refreshState.count - beforeInactiveRemove,
  accountOnePresent: accountsAfterInactive.accounts.some((account) => account.id === "acct-one"),
  openAiAccountCount: accountsAfterInactive.accounts.filter((account) => account.provider === "openai").length,
}

// H. deleting the active account clears the credential and disposes runtimes once
const beforeActiveRemove = refreshState.count
const removedActive = await removeAccount("acct-one")
const authAfterActive = readJson(authPath)
const accountsAfterActive = readJson(accountsPath)
result.removeActive = {
  result: removedActive,
  refreshDelta: refreshState.count - beforeActiveRemove,
  hasOpenAiEntry: Object.prototype.hasOwnProperty.call(authAfterActive, "openai"),
  activeId: accountsAfterActive.activeIds.openai ?? null,
  openAiAccountCount: accountsAfterActive.accounts.filter((account) => account.provider === "openai").length,
}

// I. OAuth error callback completes the pending login with exchange-failed
const errorStart = await startOpenAiLogin(0)
const errorUrl = new URL(errorStart.url)
const errorPort = Number(new URL(errorUrl.searchParams.get("redirect_uri")).port)
const errorCallback = await fetch(callbackUrl(errorPort, "error=access_denied&error_description=denied"))
result.errorCallback = {
  status: errorCallback.status,
  poll: (await pollOpenAiLogin(errorStart.pendingId)) ?? null,
}

// J. cancelling a pending login releases its callback port for reuse
const cancelStart = await startOpenAiLogin(0)
const cancelUrl = new URL(cancelStart.url)
const cancelPort = Number(new URL(cancelUrl.searchParams.get("redirect_uri")).port)
await cancelOpenAiLogin(cancelStart.pendingId)
const afterCancel = await pollOpenAiLogin(cancelStart.pendingId)
const reuse = await startOpenAiLogin(cancelPort)
const reusePort = Number(new URL(new URL(reuse.url).searchParams.get("redirect_uri")).port)
await cancelOpenAiLogin(reuse.pendingId)
result.cancel = { pollAfterCancel: afterCancel ?? null, reusedSamePort: reusePort === cancelPort }

// K. a busy callback port rejects with the requested port in the message
const throwaway = createServer()
await new Promise((resolve, reject) => {
  throwaway.once("error", reject)
  throwaway.listen(0, "127.0.0.1", resolve)
})
const throwawayAddress = throwaway.address()
const busyPort = throwawayAddress && typeof throwawayAddress === "object" ? throwawayAddress.port : 0
let busyError = null
try {
  await startOpenAiLogin(busyPort)
} catch (err) {
  busyError = err instanceof Error ? err.message : String(err)
}
await new Promise((resolve) => throwaway.close(resolve))
result.busyPort = { port: busyPort, error: busyError }

// Refresh runs against the same mock endpoint and extracts account 1 from the id_token.
const refreshed = await refreshOpenAiToken("refresh-old")
result.refresh = {
  access: refreshed.access,
  refresh: refreshed.refresh,
  accountId: refreshed.accountId ?? null,
  expiresIsFuture: refreshed.expires > Date.now(),
}

console.log("OPENAI_FIXTURE_RESULT:" + JSON.stringify(result))
process.exit(0)
`

type LoginState = { state: "pending" } | { state: "complete"; result: unknown }

type FixtureResult = {
  authorize: {
    host: string
    pathname: string
    clientId: string | null
    responseType: string | null
    scope: string | null
    codeChallengeMethod: string | null
    codeChallengeLength: number
    state: string | null
    idTokenAddOrganizations: string | null
    codexCliSimplifiedFlow: string | null
    originator: string | null
    redirectUri: string | null
    callbackPort: number
  }
  idempotent: { samePendingId: boolean; sameUrl: boolean; sameExpiresAt: boolean }
  wrongState: { status: number; poll: LoginState | null }
  callbackOne: {
    status: number
    poll: LoginState | null
    pollAgain: LoginState | null
    authEntry: { type?: string; access?: string; refresh?: string; expires?: number; accountId?: string } | null
    authKeys: string[]
    expiresIsFuture: boolean
    activeId: string | null
    accounts: { provider?: string; accountId?: string; label: string }[]
  }
  callbackTwo: {
    status: number
    poll: LoginState | null
    newPendingId: boolean
    authAccountId: string | null
    activeId: string | null
    openAiAccountCount: number
  }
  switch: {
    returnedId: string
    access: string | null
    accountId: string | null
    activeId: string | null
    refreshDelta: number
  }
  removeInactive: {
    result: { ok: true; label: string } | { ok: false; reason: string }
    refreshDelta: number
    accountOnePresent: boolean
    openAiAccountCount: number
  }
  removeActive: {
    result: { ok: true; label: string } | { ok: false; reason: string }
    refreshDelta: number
    hasOpenAiEntry: boolean
    activeId: string | null
    openAiAccountCount: number
  }
  errorCallback: { status: number; poll: LoginState | null }
  busyPort: { port: number; error: string | null }
  cancel: { pollAfterCancel: unknown; reusedSamePort: boolean }
  refresh: { access: string; refresh: string; accountId: string | null; expiresIsFuture: boolean }
}

const workDir = mkdtempSync(join(tmpdir(), "openai-callback-test-"))
const home = join(workDir, "home")
const xdg = join(workDir, "xdg")

let result: FixtureResult

describe("OpenAI browser OAuth flow (isolated child process)", () => {
  beforeAll(() => {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    mkdirSync(join(xdg, "opencode"), { recursive: true })
    const scriptPath = join(workDir, "fixture.ts")
    writeFileSync(scriptPath, FIXTURE)
    const proc = Bun.spawnSync([process.execPath, scriptPath], {
      cwd: join(SRC, ".."),
      env: { ...process.env, HOME: home, XDG_DATA_HOME: xdg },
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = proc.stdout.toString()
    const line = stdout.split("\n").find((entry) => entry.startsWith("OPENAI_FIXTURE_RESULT:"))
    if (!proc.success || !line) {
      throw new Error(
        `OpenAI fixture failed (exit ${proc.exitCode})\nstdout:\n${stdout}\nstderr:\n${proc.stderr.toString()}`,
      )
    }
    result = JSON.parse(line.slice("OPENAI_FIXTURE_RESULT:".length)) as FixtureResult
  })

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  test("authorize URL carries PKCE, loopback redirect and ChatGPT flags", () => {
    const authorize = result.authorize
    expect(authorize.host).toBe("auth.openai.com")
    expect(authorize.pathname).toBe("/oauth/authorize")
    expect(authorize.clientId).toBe("app_EMoamEEZ73f0CkXaXp7hrann")
    expect(authorize.responseType).toBe("code")
    expect(authorize.scope).toBe("openid profile email offline_access")
    expect(authorize.codeChallengeMethod).toBe("S256")
    expect(authorize.codeChallengeLength).toBeGreaterThan(0)
    expect(authorize.state).toBeTruthy()
    expect(authorize.idTokenAddOrganizations).toBe("true")
    expect(authorize.codexCliSimplifiedFlow).toBe("true")
    expect(authorize.originator).toBe("opencode")
    expect(authorize.callbackPort).toBeGreaterThan(0)
    expect(authorize.redirectUri).toBe(`http://localhost:${authorize.callbackPort}/auth/callback`)
  })

  test("starting again while pending returns the same login", () => {
    expect(result.idempotent).toEqual({ samePendingId: true, sameUrl: true, sameExpiresAt: true })
  })

  test("a callback with the wrong state is rejected and the login stays pending", () => {
    expect(result.wrongState.status).toBe(400)
    expect(result.wrongState.poll).toEqual({ state: "pending" })
  })

  test("the correct callback exchanges the code, persists accountId and completes once", () => {
    expect(result.callbackOne.status).toBe(200)
    expect(result.callbackOne.poll).toEqual({
      state: "complete",
      result: { ok: true, id: "acct-one", label: "one@example.com", existing: false },
    })
    expect(result.callbackOne.pollAgain).toEqual(result.callbackOne.poll)
    expect([...result.callbackOne.authKeys].sort()).toEqual(["access", "accountId", "expires", "refresh", "type"])
    expect(result.callbackOne.authEntry).toMatchObject({
      type: "oauth",
      access: "access-one",
      refresh: "refresh-one",
      accountId: "acct-one",
    })
    expect(result.callbackOne.expiresIsFuture).toBe(true)
    expect(result.callbackOne.activeId).toBe("acct-one")
    expect(result.callbackOne.accounts).toEqual([
      { provider: "openai", accountId: "acct-one", label: "one@example.com" },
    ])
  })

  test("a completed login does not block adding a second account", () => {
    expect(result.callbackTwo.status).toBe(200)
    expect(result.callbackTwo.newPendingId).toBe(true)
    expect(result.callbackTwo.poll).toEqual({
      state: "complete",
      result: { ok: true, id: "acct-two", label: "two@example.com", existing: false },
    })
    expect(result.callbackTwo.authAccountId).toBe("acct-two")
    expect(result.callbackTwo.activeId).toBe("acct-two")
    expect(result.callbackTwo.openAiAccountCount).toBe(2)
  })

  test("switching restores account 1 and disposes account-store runtimes once", () => {
    expect(result.switch.returnedId).toBe("acct-one")
    expect(result.switch.access).toBe("access-one")
    expect(result.switch.accountId).toBe("acct-one")
    expect(result.switch.activeId).toBe("acct-one")
    expect(result.switch.refreshDelta).toBe(1)
  })

  test("deleting an inactive account leaves runtimes and account 1 untouched", () => {
    expect(result.removeInactive.result).toEqual({ ok: true, label: "two@example.com" })
    expect(result.removeInactive.refreshDelta).toBe(0)
    expect(result.removeInactive.accountOnePresent).toBe(true)
    expect(result.removeInactive.openAiAccountCount).toBe(1)
  })

  test("deleting the active account clears the credential and disposes runtimes once", () => {
    expect(result.removeActive.result).toEqual({ ok: true, label: "one@example.com" })
    expect(result.removeActive.refreshDelta).toBe(1)
    expect(result.removeActive.hasOpenAiEntry).toBe(false)
    expect(result.removeActive.activeId).toBeNull()
    expect(result.removeActive.openAiAccountCount).toBe(0)
  })

  test("an OAuth error callback completes the login as exchange-failed", () => {
    expect(result.errorCallback.status).toBe(400)
    expect(result.errorCallback.poll).toEqual({
      state: "complete",
      result: { ok: false, reason: "exchange-failed", detail: "denied" },
    })
  })

  test("cancelling a login frees its callback port", () => {
    expect(result.cancel.pollAfterCancel).toBeNull()
    expect(result.cancel.reusedSamePort).toBe(true)
  })

  test("starting a login on a busy port rejects naming the port", () => {
    expect(result.busyPort.port).toBeGreaterThan(0)
    expect(result.busyPort.error).toContain(`port ${result.busyPort.port}`)
  })

  test("refresh returns rotated tokens and extracts the account id from the id_token", () => {
    expect(result.refresh.access).toBe("access-refreshed")
    expect(result.refresh.refresh).toBe("refresh-refreshed")
    expect(result.refresh.accountId).toBe("acct-one")
    expect(result.refresh.expiresIsFuture).toBe(true)
  })
})

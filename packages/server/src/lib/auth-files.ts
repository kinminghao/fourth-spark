import { readFile, writeFile, mkdir, rename } from "node:fs/promises"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { withFileLock } from "./lockfile"

export type ProviderId = "anthropic" | "openai"

export type StoredAccount = {
  id: string
  label: string
  refresh: string
  access?: string
  expires?: number
  excluded?: boolean
  needsReauth?: boolean
  provider?: ProviderId
  accountId?: string
  lastActiveAt?: number
  subscription?: Record<string, unknown>
  refreshMintedAt?: number
}

export type AccountsFile = {
  version: number
  activeId?: string
  openaiActiveId?: string
  accounts: StoredAccount[]
}

export function providerOf(account: StoredAccount): ProviderId {
  return account.provider ?? "anthropic"
}

export function accountsOf(file: AccountsFile, provider: ProviderId): StoredAccount[] {
  return file.accounts.filter((a) => providerOf(a) === provider)
}

export function applyToken(record: StoredAccount, token: { refresh: string; access?: string; expires?: number }): StoredAccount {
  if (token.refresh !== record.refresh) record.refreshMintedAt = Date.now()
  record.refresh = token.refresh
  record.access = token.access
  record.expires = token.expires
  delete record.needsReauth
  return record
}

type AuthJson = Record<string, { type: string; access?: string; refresh?: string; expires?: number }>

const ACCOUNTS_PATH = join(homedir(), ".config", "opencode", "claude-accounts.json")

const AUTH_JSON_CANDIDATES = [
  process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, "opencode", "auth.json") : "",
  join(homedir(), ".local", "share", "opencode", "auth.json"),
  join(homedir(), "Library", "Application Support", "opencode", "auth.json"),
].filter(Boolean)

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return undefined
  }
}

async function atomicWrite(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  await rename(tmp, path)
}

let resolvedAuthPath: string | undefined

async function resolveAuthJsonPath(): Promise<string> {
  if (resolvedAuthPath) return resolvedAuthPath
  for (const candidate of AUTH_JSON_CANDIDATES) {
    if (await readJson(candidate)) {
      resolvedAuthPath = candidate
      return candidate
    }
  }
  resolvedAuthPath = AUTH_JSON_CANDIDATES[0]
  return resolvedAuthPath
}

export async function loadAccounts(): Promise<AccountsFile> {
  const data = await readJson<Partial<AccountsFile>>(ACCOUNTS_PATH)
  return {
    version: data?.version ?? 1,
    activeId: data?.activeId,
    openaiActiveId: data?.openaiActiveId,
    accounts: Array.isArray(data?.accounts)
      ? (data!.accounts as StoredAccount[]).filter((a) => typeof a.id === "string" && a.id.length > 0)
      : [],
  }
}

export async function saveAccounts(file: AccountsFile): Promise<void> {
  await atomicWrite(ACCOUNTS_PATH, file)
}

export async function readAuthAnthropic(): Promise<{ access?: string; refresh?: string; expires?: number } | undefined> {
  const path = await resolveAuthJsonPath()
  const auth = await readJson<AuthJson>(path)
  const entry = auth?.["anthropic"]
  if (entry?.type === "oauth") return { access: entry.access, refresh: entry.refresh, expires: entry.expires }
  return undefined
}

export async function writeAuthAnthropic(token: { refresh: string; access?: string; expires?: number }): Promise<void> {
  const path = await resolveAuthJsonPath()
  let auth: AuthJson
  try {
    auth = JSON.parse(await readFile(path, "utf8")) as AuthJson
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "ENOENT") {
      auth = {}
    } else {
      throw err
    }
  }
  auth["anthropic"] = { type: "oauth", access: token.access ?? "", refresh: token.refresh, expires: token.expires ?? 0 }
  await atomicWrite(path, auth)
}

// ---------------------------------------------------------------------------
// Cross-process auth lock
// ---------------------------------------------------------------------------
// Serialises auth.json / claude-accounts.json read-modify-writes. The lock file
// path is deliberately identical to the one claude-accounts-pool uses so both
// processes are mutually exclusive. Lazily resolved (and cached) so auth.json
// does not need to exist at import time.

let lockPathPromise: Promise<string> | undefined
function authLockPath(): Promise<string> {
  lockPathPromise ??= resolveAuthJsonPath().then((p) => join(dirname(p), "claude-accounts-usage.lock"))
  return lockPathPromise
}

// In-process queue + cross-process file lock (same pattern as claude-accounts-pool).
// NOT reentrant: never nest withAuthLock inside another withAuthLock.
let authLock: Promise<unknown> = Promise.resolve()

export function withAuthLock<T>(fn: () => Promise<T>): Promise<T> {
  const job = async () => withFileLock(await authLockPath(), fn)
  const run = authLock.then(job, job)
  authLock = run.then(() => undefined, () => undefined)
  return run
}

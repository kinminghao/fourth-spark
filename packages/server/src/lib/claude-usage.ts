/**
 * Read Claude account subscription usage from the claude-accounts-usage plugin's
 * stored accounts + Anthropic's oauth/usage API.
 *
 * Data flow:
 *   ~/.config/opencode/claude-accounts.json  → account list + tokens
 *   ~/Library/Application Support/opencode/auth.json  → active account's live token
 *   https://api.anthropic.com/api/oauth/usage  → subscription utilization
 */

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { logger } from "../middleware/logger"

// ---------------------------------------------------------------------------
// Constants (mirrored from claude-accounts-usage plugin)
// ---------------------------------------------------------------------------

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage"
const OAUTH_BETA = "oauth-2025-04-20"
const NETWORK_TIMEOUT_MS = 15_000
const TOKEN_EXPIRY_BUFFER_MS = 60_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StoredAccount {
  id: string
  label: string
  refresh: string
  access?: string
  expires?: number
  excluded?: boolean
  needsReauth?: boolean
}

interface AccountsFile {
  version: number
  activeId?: string
  accounts: StoredAccount[]
}

interface AnthropicOauth {
  type: "oauth"
  access?: string
  refresh?: string
  expires?: number
}

export interface UsageWindow {
  utilization: number
  resets_at?: string
}

export interface ScopedUsageWindow extends UsageWindow {
  label: string
}

export interface UsageResponse {
  five_hour?: UsageWindow | null
  seven_day?: UsageWindow | null
  seven_day_sonnet?: UsageWindow | null
  seven_day_opus?: UsageWindow | null
  scoped?: ScopedUsageWindow[]
}

export interface AccountUsage {
  id: string
  label: string
  active: boolean
  excluded: boolean
  usage?: UsageResponse
  error?: string
  needsReauth?: boolean
}

export interface UsageResult {
  activeId?: string
  accounts: AccountUsage[]
}

// ---------------------------------------------------------------------------
// File reading helpers
// ---------------------------------------------------------------------------

const ACCOUNTS_PATH = join(homedir(), ".config", "opencode", "claude-accounts.json")

function authJsonCandidates(): string[] {
  const list: string[] = []
  if (process.env.XDG_DATA_HOME) {
    list.push(join(process.env.XDG_DATA_HOME, "opencode", "auth.json"))
  }
  list.push(join(homedir(), ".local", "share", "opencode", "auth.json"))
  list.push(join(homedir(), "Library", "Application Support", "opencode", "auth.json"))
  return list
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return undefined
  }
}

async function loadAccounts(): Promise<AccountsFile> {
  const data = await readJson<Partial<AccountsFile>>(ACCOUNTS_PATH)
  return {
    version: data?.version ?? 1,
    activeId: data?.activeId,
    accounts: Array.isArray(data?.accounts)
      ? (data!.accounts as StoredAccount[]).filter(
          (a) => typeof a.id === "string" && a.id.length > 0,
        )
      : [],
  }
}

async function readAuthAnthropic(): Promise<AnthropicOauth | undefined> {
  for (const candidate of authJsonCandidates()) {
    const auth = await readJson<Record<string, unknown>>(candidate)
    const entry = auth?.["anthropic"]
    if (entry && typeof entry === "object" && (entry as AnthropicOauth).type === "oauth") {
      return entry as AnthropicOauth
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

function isStale(token: { access?: string; expires?: number }): boolean {
  return !token.access || !token.expires || token.expires < Date.now() + TOKEN_EXPIRY_BUFFER_MS
}

async function refreshToken(
  refresh: string,
): Promise<{ access: string; refresh: string; expires: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: CLIENT_ID,
    }),
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`token refresh failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const json = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
  }
}

// ---------------------------------------------------------------------------
// Usage fetching
// ---------------------------------------------------------------------------

interface RawLimit {
  kind?: string
  percent?: unknown
  resets_at?: unknown
  scope?: { model?: { display_name?: unknown } | null } | null
}

function scopedFromLimits(limits: unknown): ScopedUsageWindow[] | undefined {
  if (!Array.isArray(limits)) return undefined
  const out: ScopedUsageWindow[] = []
  for (const raw of limits as RawLimit[]) {
    if (raw?.kind !== "weekly_scoped") continue
    const label = raw.scope?.model?.display_name
    if (typeof label !== "string" || label.length === 0) continue
    if (typeof raw.percent !== "number" || !Number.isFinite(raw.percent)) continue
    const resets_at = typeof raw.resets_at === "string" ? raw.resets_at : undefined
    out.push({ label, utilization: raw.percent, resets_at })
  }
  return out.length > 0 ? out : undefined
}

async function fetchUsage(access: string): Promise<UsageResponse> {
  const res = await fetch(USAGE_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${access}`,
      "anthropic-beta": OAUTH_BETA,
    },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`usage request failed (${res.status})`)
  }
  const usage = (await res.json()) as UsageResponse & { limits?: unknown }
  const scoped = scopedFromLimits(usage.limits)
  if (scoped) usage.scoped = scoped
  return usage
}

// ---------------------------------------------------------------------------
// Resolve a usable access token for an account
// ---------------------------------------------------------------------------

async function resolveAccess(
  account: StoredAccount,
  isActive: boolean,
  liveAuth: AnthropicOauth | undefined,
): Promise<{ access?: string; error?: string; needsReauth?: boolean }> {
  // Active account: prefer the live token from auth.json (kept fresh by the
  // TUI plugin's keeper or ex-machina).
  if (isActive && liveAuth?.access && liveAuth.expires && liveAuth.expires >= Date.now()) {
    return { access: liveAuth.access }
  }

  // If account has a non-stale stored token, use it.
  if (!isStale(account)) {
    return { access: account.access }
  }

  // Account is flagged as needing re-login — don't try to refresh.
  if (account.needsReauth) {
    // Still have a live access token? Use it for usage (read-only is fine).
    if (account.access && account.expires && account.expires >= Date.now()) {
      return { access: account.access, needsReauth: true }
    }
    return { error: "需重新登录", needsReauth: true }
  }

  // Try to refresh. If it fails, degrade gracefully.
  try {
    const fresh = await refreshToken(account.refresh)
    // NOTE: we intentionally do NOT write back to claude-accounts.json here.
    // The TUI plugin owns that file with cross-process locking. We just use
    // the fresh token for this one API call.
    return { access: fresh.access }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn({ accountId: account.id, error: msg }, "claude-usage: token refresh failed")
    return { error: msg }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function collectUsage(): Promise<UsageResult> {
  const file = await loadAccounts()
  const auth = await readAuthAnthropic()

  const results: AccountUsage[] = []

  for (const account of file.accounts) {
    const isActive = account.id === file.activeId
    const base: AccountUsage = {
      id: account.id,
      label: account.label,
      active: isActive,
      excluded: account.excluded ?? false,
    }

    const resolved = await resolveAccess(account, isActive, auth)
    if (resolved.needsReauth) base.needsReauth = true

    if (!resolved.access) {
      results.push({ ...base, error: resolved.error ?? "no access token" })
      continue
    }

    try {
      const usage = await fetchUsage(resolved.access)
      results.push({ ...base, usage })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn({ accountId: account.id, error: msg }, "claude-usage: fetch failed")
      results.push({ ...base, error: msg })
    }
  }

  return { activeId: file.activeId, accounts: results }
}

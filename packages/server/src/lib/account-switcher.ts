import { loadAccounts, saveAccounts, readAuthAnthropic, writeAuthAnthropic, type StoredAccount, type AccountsFile } from "./auth-files"
import { logger } from "../middleware/logger"

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
const TOKEN_EXPIRY_BUFFER_MS = 60_000
const NETWORK_TIMEOUT_MS = 15_000

const cooldown = new Map<string, number>()

const RATE_LIMIT_RE = /rate limit|usage limit|limit reached|too many requests|out of (?:usage|quota)|5[- ]?hour|weekly limit|exceed/i

export function isUsageLimit(message?: string): boolean {
  if (!message) return false
  return RATE_LIMIT_RE.test(message)
}

export function markCooldown(id: string, untilMs?: number): void {
  if (typeof untilMs === "number" && Number.isFinite(untilMs)) {
    cooldown.set(id, untilMs)
    logger.info({ id, until: new Date(untilMs).toISOString() }, "account cooldown set")
  } else {
    cooldown.set(id, Date.now() + 30 * 60_000)
    logger.info({ id }, "account cooldown set (default 30min)")
  }
}

export function clearCooldown(id: string): void {
  if (cooldown.delete(id)) {
    logger.info({ id }, "account cooldown cleared")
  }
}

function isCooled(id: string): boolean {
  const until = cooldown.get(id)
  if (typeof until !== "number") return false
  if (until <= Date.now()) {
    cooldown.delete(id)
    return false
  }
  return true
}

function isStale(account: StoredAccount): boolean {
  return !account.access || !account.expires || account.expires < Date.now() + TOKEN_EXPIRY_BUFFER_MS
}

async function refreshToken(refresh: string): Promise<{ access: string; refresh: string; expires: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/plain, */*", "User-Agent": "axios/1.13.6" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refresh, client_id: CLIENT_ID }),
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`token refresh failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number }
  return { access: json.access_token, refresh: json.refresh_token, expires: Date.now() + json.expires_in * 1000 }
}

function pickNext(file: AccountsFile, activeId?: string): StoredAccount | undefined {
  const candidates = file.accounts.filter(
    (a) => a.id !== activeId && !isCooled(a.id) && !a.excluded && !a.needsReauth,
  )
  if (candidates.length === 0) return undefined
  const order = file.accounts.map((a) => a.id)
  const start = activeId ? order.indexOf(activeId) : -1
  for (let offset = 1; offset <= order.length; offset++) {
    const id = order[(start + offset + order.length) % order.length]
    const match = candidates.find((a) => a.id === id)
    if (match) return match
  }
  return candidates[0]
}

export async function switchToAccount(targetId: string): Promise<StoredAccount> {
  const file = await loadAccounts()
  const index = file.accounts.findIndex((a) => a.id === targetId)
  if (index < 0) throw new Error("account not found")
  if (file.accounts[index].needsReauth) throw new Error("account needs reauth")

  const outAuth = await readAuthAnthropic()
  if (file.activeId && file.activeId !== targetId && outAuth?.refresh) {
    const outIdx = file.accounts.findIndex((a) => a.id === file.activeId)
    if (outIdx >= 0) {
      file.accounts[outIdx].refresh = outAuth.refresh
      file.accounts[outIdx].access = outAuth.access
      file.accounts[outIdx].expires = outAuth.expires
    }
  }

  let account = file.accounts[index]
  if (isStale(account)) {
    try {
      const fresh = await refreshToken(account.refresh)
      account.refresh = fresh.refresh
      account.access = fresh.access
      account.expires = fresh.expires
      delete account.needsReauth
    } catch (err) {
      logger.warn({ err, id: targetId }, "failed to refresh target account token")
      throw err
    }
  }

  file.activeId = targetId
  await saveAccounts(file)
  await writeAuthAnthropic({ refresh: account.refresh, access: account.access, expires: account.expires })
  logger.info({ id: targetId, label: account.label }, "switched active account")
  return account
}

export type SwitchResult = { switched: true; from?: string; to: string; label: string } | { switched: false; reason: string }

export async function autoSwitch(currentActiveId?: string): Promise<SwitchResult> {
  if (currentActiveId) markCooldown(currentActiveId)

  const file = await loadAccounts()
  if (file.accounts.length <= 1) return { switched: false, reason: "only one account" }

  const next = pickNext(file, currentActiveId)
  if (!next) return { switched: false, reason: "no available accounts" }

  try {
    const account = await switchToAccount(next.id)
    return { switched: true, from: currentActiveId, to: account.id, label: account.label }
  } catch (err) {
    markCooldown(next.id)
    logger.warn({ err, id: next.id }, "switch candidate failed, trying next")
  }

  const secondNext = pickNext(file, currentActiveId)
  if (!secondNext || secondNext.id === next.id) return { switched: false, reason: "all candidates failed" }

  try {
    const account = await switchToAccount(secondNext.id)
    return { switched: true, from: currentActiveId, to: account.id, label: account.label }
  } catch {
    markCooldown(secondNext.id)
    return { switched: false, reason: "all candidates failed" }
  }
}

export async function getActiveId(): Promise<string | undefined> {
  return (await loadAccounts()).activeId
}

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { loadAccounts, saveAccounts, readAuthAnthropic, writeAuthAnthropic, withAuthLock, accountsOf, providerOf, applyToken, type StoredAccount, type AccountsFile } from "./auth-files"
import { refreshToken, isStale as isTokenStale, RefreshRevokedError } from "./token-refresh"
import { logger } from "../middleware/logger"

const COOLDOWN_FILE = join("/tmp", "fourth-spark", "cooldown.json")

const cooldown = new Map<string, number>()
const cooldownPending = new Set<string>()
const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()

function persistCooldown(): void {
  const now = Date.now()
  const snapshot: Record<string, number> = {}
  for (const [id, until] of cooldown) if (until > now) snapshot[id] = until
  try {
    mkdirSync(join("/tmp", "fourth-spark"), { recursive: true })
    writeFileSync(COOLDOWN_FILE, JSON.stringify(snapshot))
  } catch {
    // best-effort
  }
}

function restoreCooldown(): void {
  try {
    const raw = readFileSync(COOLDOWN_FILE, "utf8")
    const stored = JSON.parse(raw) as Record<string, number>
    const now = Date.now()
    for (const [id, until] of Object.entries(stored)) {
      if (typeof until !== "number" || until <= now) continue
      cooldown.set(id, until)
      scheduleRecovery(id, until)
    }
    if (cooldown.size > 0) logger.info({ count: cooldown.size }, "restored cooldown state from disk")
  } catch {
    // no file or corrupt — start fresh
  }
}

restoreCooldown()

const RATE_LIMIT_RE = /rate limit|usage limit|limit reached|too many requests|out of (?:usage|quota)|5[- ]?hour|weekly limit|exceed/i

export function isUsageLimit(message?: string): boolean {
  if (!message) return false
  if (/overloaded_error/i.test(message)) return false
  return RATE_LIMIT_RE.test(message)
}

const RESET_DURATION_RE = /(\d+)\s*(?:hour|小时|h)/i
const RESET_MINUTES_RE = /(\d+)\s*(?:minute|分钟|min)/i

export function parseResetMsFromMessage(message?: string): number | undefined {
  if (!message) return undefined
  const hours = message.match(RESET_DURATION_RE)
  if (hours) return Date.now() + Number(hours[1]) * 3600_000
  const minutes = message.match(RESET_MINUTES_RE)
  if (minutes) return Date.now() + Number(minutes[1]) * 60_000
  return undefined
}

function scheduleRecovery(id: string, until: number): void {
  const existing = recoveryTimers.get(id)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    recoveryTimers.delete(id)
    cooldown.delete(id)
    cooldownPending.delete(id)
    logger.info({ id }, "account cooldown expired, rejoining selection")
  }, Math.max(0, until - Date.now()))
  timer.unref?.()
  recoveryTimers.set(id, timer)
}

export function markCooldown(id: string, untilMs?: number): void {
  if (typeof untilMs === "number" && Number.isFinite(untilMs)) {
    cooldownPending.delete(id)
    cooldown.set(id, untilMs)
    scheduleRecovery(id, untilMs)
    persistCooldown()
    logger.info({ id, until: new Date(untilMs).toISOString() }, "account cooldown set")
  } else {
    cooldown.delete(id)
    cooldownPending.add(id)
    logger.info({ id }, "account cooldown set (unknown deadline)")
  }
}

export function clearCooldown(id: string): void {
  const timer = recoveryTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    recoveryTimers.delete(id)
  }
  cooldownPending.delete(id)
  if (cooldown.delete(id)) {
    persistCooldown()
    logger.info({ id }, "account cooldown cleared")
  }
}

function isCooled(id: string): boolean {
  if (cooldownPending.has(id)) return true
  const until = cooldown.get(id)
  if (typeof until !== "number") return false
  if (until <= Date.now()) {
    cooldown.delete(id)
    return false
  }
  return true
}

function pickNext(file: AccountsFile, activeId?: string): StoredAccount | undefined {
  const pool = accountsOf(file, "anthropic")
  const candidates = pool.filter(
    (a) => a.id !== activeId && !isCooled(a.id) && !a.excluded && !a.needsReauth,
  )
  if (candidates.length === 0) return undefined
  const order = pool.map((a) => a.id)
  const start = activeId ? order.indexOf(activeId) : -1
  for (let offset = 1; offset <= order.length; offset++) {
    const id = order[(start + offset + order.length) % order.length]
    const match = candidates.find((a) => a.id === id)
    if (match) return match
  }
  return candidates[0]
}

export async function switchToAccount(targetId: string): Promise<StoredAccount> {
  return withAuthLock(async () => {
    const file = await loadAccounts()
    const index = file.accounts.findIndex((a) => a.id === targetId)
    if (index < 0) throw new Error("account not found")

    const provider = providerOf(file.accounts[index])
    if (provider !== "anthropic") throw new Error("该账号与目标 provider 不一致,拒绝写入 Claude 登录态")
    if (file.accounts[index].needsReauth) throw new Error("account needs reauth")

    const outAuth = await readAuthAnthropic()
    if (file.activeId && file.activeId !== targetId && outAuth?.refresh) {
      const outIdx = file.accounts.findIndex((a) => a.id === file.activeId)
      if (outIdx >= 0) {
        applyToken(file.accounts[outIdx], { refresh: outAuth.refresh, access: outAuth.access, expires: outAuth.expires })
      }
    }

    let account = file.accounts[index]
    if (isTokenStale(account)) {
      try {
        const fresh = await refreshToken(account.refresh)
        applyToken(account, fresh)
      } catch (err) {
        if (err instanceof RefreshRevokedError) {
          const latest = await loadAccounts()
          const rec = latest.accounts.find((a) => a.id === targetId)
          if (rec && !rec.needsReauth && rec.refresh !== err.refresh) {
            logger.info({ id: targetId }, "adopted foreign rotation during switch")
            applyToken(account, { refresh: rec.refresh, access: rec.access, expires: rec.expires })
          } else {
            if (rec && !rec.needsReauth) {
              rec.needsReauth = true
              await saveAccounts(latest)
            }
            logger.warn({ id: targetId }, "account refresh revoked, needs reauth")
            throw err
          }
        } else {
          logger.warn({ err, id: targetId }, "failed to refresh target account token")
          throw err
        }
      }
    }

    file.activeId = targetId
    await saveAccounts(file)
    await writeAuthAnthropic({ refresh: account.refresh, access: account.access, expires: account.expires })
    logger.info({ id: targetId, label: account.label }, "switched active account")
    return account
  })
}

export type SwitchResult = { switched: true; from?: string; to: string; label: string } | { switched: false; reason: string }

export async function autoSwitch(currentActiveId?: string): Promise<SwitchResult> {
  if (currentActiveId) markCooldown(currentActiveId)

  const file = await loadAccounts()
  if (accountsOf(file, "anthropic").length <= 1) return { switched: false, reason: "only one account" }

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

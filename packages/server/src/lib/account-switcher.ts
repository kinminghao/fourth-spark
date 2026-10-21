import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { logger } from "../middleware/logger"
import { getAccountProvider } from "./account-providers"
import {
  type AccountsFile,
  accountsOf,
  applyToken,
  loadAccounts,
  type ProviderId,
  providerOf,
  type StoredAccount,
  saveAccounts,
  withAuthLock,
} from "./auth-files"
import { broadcastCredentialToRuntimes } from "./credential-broadcast"
import { refreshAccountStoreRuntimes } from "./credential-refresh"
import { RefreshRevokedError } from "./token-refresh"

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

const RATE_LIMIT_RE =
  /rate limit|usage limit|limit reached|too many requests|out of (?:usage|quota)|5[- ]?hour|weekly limit|exceed/i

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
  const timer = setTimeout(
    () => {
      recoveryTimers.delete(id)
      cooldown.delete(id)
      cooldownPending.delete(id)
      logger.info({ id }, "account cooldown expired, rejoining selection")
    },
    Math.max(0, until - Date.now()),
  )
  timer.unref?.()
  recoveryTimers.set(id, timer)
}

const DEFAULT_COOLDOWN_MS = 30 * 60_000

export function markCooldown(id: string, untilMs?: number): void {
  const deadline = typeof untilMs === "number" && Number.isFinite(untilMs) ? untilMs : Date.now() + DEFAULT_COOLDOWN_MS
  cooldownPending.delete(id)
  cooldown.set(id, deadline)
  scheduleRecovery(id, deadline)
  persistCooldown()
  logger.info({ id, until: new Date(deadline).toISOString(), fallback: untilMs === undefined }, "account cooldown set")
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

function pickNext(file: AccountsFile, provider: ProviderId, activeId?: string): StoredAccount | undefined {
  const pool = accountsOf(file, provider)
  const candidates = pool.filter((a) => a.id !== activeId && !isCooled(a.id) && !a.excluded && !a.needsReauth)
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

export async function switchToAccount(provider: ProviderId, targetId: string): Promise<StoredAccount> {
  const { account, credentialKind, refreshRuntimesOnSwitch } = await withAuthLock(async () => {
    const file = await loadAccounts()
    const index = file.accounts.findIndex((a) => a.id === targetId)
    if (index < 0) throw new Error("account not found")

    const account = file.accounts[index]
    if (providerOf(account) !== provider) throw new Error("该账号与目标 provider 不一致,拒绝写入 Claude 登录态")
    if (account.needsReauth) throw new Error("account needs reauth")

    const descriptor = getAccountProvider(provider)
    const { credentialAdapter, refresh } = descriptor
    const liveAuth = await credentialAdapter.read()
    const activeId = file.activeIds[provider]
    // Static api-key credentials never rotate; adopting the live key would
    // corrupt the outgoing record's identity (hash id/label keep pointing at
    // the original key while the secret becomes a foreign one).
    if (credentialAdapter.kind === "oauth" && activeId && activeId !== targetId && liveAuth?.refresh) {
      const outIdx = file.accounts.findIndex((a) => a.id === activeId)
      if (outIdx >= 0) {
        applyToken(file.accounts[outIdx], {
          refresh: liveAuth.refresh,
          access: liveAuth.access,
          expires: liveAuth.expires,
          accountId: liveAuth.accountId,
        })
      }
    }

    if (refresh.isStale(account)) {
      try {
        const fresh = await refresh.refresh(account.refresh)
        applyToken(account, fresh)
      } catch (err) {
        if (err instanceof RefreshRevokedError) {
          const latest = await loadAccounts()
          const rec = latest.accounts.find((a) => a.id === targetId)
          if (rec && !rec.needsReauth && rec.refresh !== err.refresh) {
            logger.info({ id: targetId }, "adopted foreign rotation during switch")
            applyToken(account, {
              refresh: rec.refresh,
              access: rec.access,
              expires: rec.expires,
              accountId: rec.accountId,
            })
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

    file.activeIds[provider] = targetId
    await saveAccounts(file)
    await credentialAdapter.write({
      kind: "full",
      refresh: account.refresh,
      access: account.access,
      expires: account.expires,
      accountId: account.accountId,
    })
    await broadcastCredentialToRuntimes(provider, {
      kind: "full",
      refresh: account.refresh,
      access: account.access,
      expires: account.expires,
      accountId: account.accountId,
    })
    logger.info({ id: targetId, label: account.label }, "switched active account")
    return {
      account,
      credentialKind: credentialAdapter.kind,
      refreshRuntimesOnSwitch: descriptor.refreshRuntimesOnSwitch === true,
    }
  })
  // Static api-key credentials are baked into runtime instance state at start,
  // and providers that opencode reads directly cache the credential per
  // instance; rebuild that state so the switched credential applies live.
  if (credentialKind === "api-key" || refreshRuntimesOnSwitch) {
    const { runtimeManager } = await import("./process-manager")
    await refreshAccountStoreRuntimes(runtimeManager.listProviders())
  }
  return account
}

export type SwitchResult =
  | { switched: true; from?: string; to: string; label: string }
  | { switched: false; reason: string }

export async function autoSwitch(provider: ProviderId, currentActiveId?: string): Promise<SwitchResult> {
  if (currentActiveId) markCooldown(currentActiveId)

  const file = await loadAccounts()
  if (accountsOf(file, provider).length <= 1) return { switched: false, reason: "only one account" }

  const next = pickNext(file, provider, currentActiveId)
  if (!next) return { switched: false, reason: "no available accounts" }

  try {
    const account = await switchToAccount(provider, next.id)
    return { switched: true, from: currentActiveId, to: account.id, label: account.label }
  } catch (err) {
    markCooldown(next.id)
    logger.warn({ err, id: next.id }, "switch candidate failed, trying next")
  }

  const secondNext = pickNext(file, provider, currentActiveId)
  if (!secondNext || secondNext.id === next.id) return { switched: false, reason: "all candidates failed" }

  try {
    const account = await switchToAccount(provider, secondNext.id)
    return { switched: true, from: currentActiveId, to: account.id, label: account.label }
  } catch {
    markCooldown(secondNext.id)
    return { switched: false, reason: "all candidates failed" }
  }
}

export async function getActiveId(provider: ProviderId): Promise<string | undefined> {
  return (await loadAccounts()).activeIds[provider]
}

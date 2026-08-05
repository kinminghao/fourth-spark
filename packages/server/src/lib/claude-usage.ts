import { loadAccounts, readAuthAnthropic, accountsOf, type StoredAccount } from "./auth-files"
import { refreshToken, isStale } from "./token-refresh"
import { logger } from "../middleware/logger"
import { isWorkerMode, getWorkerConfig } from "./config"
import { createUsageClient, type UsageSnapshotView } from "./usage-client"

const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage"
const OAUTH_BETA = "oauth-2025-04-20"
const NETWORK_TIMEOUT_MS = 15_000

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

async function resolveAccess(
  account: StoredAccount,
  isActive: boolean,
  liveAuth: { access?: string; refresh?: string; expires?: number } | undefined,
): Promise<{ access?: string; error?: string; needsReauth?: boolean }> {
  if (isActive && liveAuth?.access && liveAuth.expires && liveAuth.expires >= Date.now()) {
    return { access: liveAuth.access }
  }

  if (!isStale(account)) {
    return { access: account.access }
  }

  if (account.needsReauth) {
    if (account.access && account.expires && account.expires >= Date.now()) {
      return { access: account.access, needsReauth: true }
    }
    return { error: "需重新登录", needsReauth: true }
  }

  try {
    const fresh = await refreshToken(account.refresh)
    return { access: fresh.access }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn({ accountId: account.id, error: msg }, "claude-usage: token refresh failed")
    return { error: msg }
  }
}

const USAGE_CACHE_TTL_MS = 30_000
let usageCache: { result: UsageResult; fetchedAt: number } | null = null

function snapshotToUsageResult(view: UsageSnapshotView, activeId?: string): UsageResult {
  const accounts: AccountUsage[] = view.accounts.map((a) => {
    const usage: UsageResponse | undefined = a.hasUsage && a.windows.length > 0
      ? {
          five_hour: a.windows.find((w) => w.label === "5 小时" || w.label === "five_hour")
            ? { utilization: a.windows.find((w) => w.label === "5 小时" || w.label === "five_hour")!.utilization, resets_at: a.windows.find((w) => w.label === "5 小时" || w.label === "five_hour")!.resetsAt }
            : undefined,
          seven_day: a.windows.find((w) => w.label === "7 天" || w.label === "seven_day")
            ? { utilization: a.windows.find((w) => w.label === "7 天" || w.label === "seven_day")!.utilization, resets_at: a.windows.find((w) => w.label === "7 天" || w.label === "seven_day")!.resetsAt }
            : undefined,
          scoped: a.windows
            .filter((w) => w.label !== "5 小时" && w.label !== "five_hour" && w.label !== "7 天" && w.label !== "seven_day")
            .map((w) => ({ label: w.label, utilization: w.utilization, resets_at: w.resetsAt })),
        }
      : undefined
    return {
      id: a.idPrefix,
      label: a.label,
      active: activeId ? a.idPrefix === activeId.slice(0, a.idPrefix.length) : false,
      excluded: a.excluded,
      needsReauth: a.needsReauth || undefined,
      usage,
      error: a.coolingDown ? "额度冷却中" : undefined,
    }
  })
  return { activeId, accounts }
}

export async function collectUsage(): Promise<UsageResult> {
  if (usageCache && Date.now() - usageCache.fetchedAt < USAGE_CACHE_TTL_MS) {
    return usageCache.result
  }

  if (isWorkerMode()) {
    const cfg = getWorkerConfig()
    if (!cfg) return { accounts: [] }
    const client = createUsageClient(cfg.masterUrl)
    const outcome = await client.fetchSnapshot()
    if (!outcome.ok) {
      logger.warn({ failure: outcome.failure.kind }, "claude-usage: worker fetch failed")
      return { accounts: [] }
    }
    const file = await loadAccounts()
    const result = snapshotToUsageResult(outcome.view, file.activeId)
    usageCache = { result, fetchedAt: Date.now() }
    return result
  }

  const file = await loadAccounts()
  const auth = await readAuthAnthropic()
  const pool = accountsOf(file, "anthropic")

  const results: AccountUsage[] = []

  for (const account of pool) {
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

  const result: UsageResult = { activeId: file.activeId, accounts: results }
  usageCache = { result, fetchedAt: Date.now() }
  return result
}

export function retagActiveInCache(newActiveId: string): UsageResult | null {
  if (!usageCache) return null
  const updated: UsageResult = {
    activeId: newActiveId,
    accounts: usageCache.result.accounts.map((a) => ({
      ...a,
      active: a.id === newActiveId || newActiveId.startsWith(a.id),
    })),
  }
  usageCache = { result: updated, fetchedAt: usageCache.fetchedAt }
  return updated
}

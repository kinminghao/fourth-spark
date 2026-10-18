import { logger } from "../middleware/logger"
import { DEFAULT_ACCOUNT_PROVIDER, getAccountProvider } from "./account-providers"
import type { RefreshStrategy, UsageResponse } from "./account-providers/types"
import { accountsOf, loadAccounts, type ProviderId, type StoredAccount } from "./auth-files"
import { getWorkerConfig, isWorkerMode } from "./config"
import { createUsageClient, type UsageSnapshotView } from "./usage-client"

export interface AccountUsage {
  id: string
  label: string
  active: boolean
  excluded: boolean
  usage?: UsageResponse
  error?: string
  needsReauth?: boolean
  holders?: string[]
}

export interface UsageResult {
  activeId?: string
  accounts: AccountUsage[]
}

async function resolveAccess(
  account: StoredAccount,
  isActive: boolean,
  liveAuth: { access?: string; refresh?: string; expires?: number } | undefined,
  refresh: RefreshStrategy,
): Promise<{ access?: string; error?: string; needsReauth?: boolean }> {
  if (isActive && liveAuth?.access && liveAuth.expires && liveAuth.expires >= Date.now()) {
    return { access: liveAuth.access }
  }

  if (!refresh.isStale(account)) {
    return { access: account.access }
  }

  if (account.needsReauth) {
    if (account.access && account.expires && account.expires >= Date.now()) {
      return { access: account.access, needsReauth: true }
    }
    return { error: "需重新登录", needsReauth: true }
  }

  try {
    const fresh = await refresh.refresh(account.refresh)
    return { access: fresh.access }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn({ accountId: account.id, error: msg }, "claude-usage: token refresh failed")
    return { error: msg }
  }
}

const USAGE_CACHE_TTL_MS = 30_000
const usageCaches = new Map<ProviderId, { result: UsageResult; fetchedAt: number }>()

function snapshotToUsageResult(view: UsageSnapshotView, activeId?: string): UsageResult {
  const accounts: AccountUsage[] = view.accounts.map((a) => {
    const fhWindow = a.windows.find((w) => w.label === "5 小时" || w.label === "five_hour")
    const sdWindow = a.windows.find((w) => w.label === "7 天" || w.label === "seven_day")
    const usage: UsageResponse | undefined =
      a.hasUsage && a.windows.length > 0
        ? {
            five_hour: fhWindow ? { utilization: fhWindow.utilization, resets_at: fhWindow.resetsAt } : undefined,
            seven_day: sdWindow ? { utilization: sdWindow.utilization, resets_at: sdWindow.resetsAt } : undefined,
            scoped: a.windows
              .filter(
                (w) => w.label !== "5 小时" && w.label !== "five_hour" && w.label !== "7 天" && w.label !== "seven_day",
              )
              .map((w) => ({ label: w.label, utilization: w.utilization, resets_at: w.resetsAt })),
          }
        : undefined
    return {
      id: a.idPrefix,
      label: a.label,
      active: activeId ? a.idPrefix === activeId.slice(0, a.idPrefix.length) : false,
      excluded: a.excluded,
      needsReauth: a.needsReauth || undefined,
      holders: a.holders,
      usage,
      error: a.coolingDown ? "额度冷却中" : undefined,
    }
  })
  return { activeId, accounts }
}

export async function collectUsage(provider: ProviderId): Promise<UsageResult> {
  const cached = usageCaches.get(provider)
  if (cached && Date.now() - cached.fetchedAt < USAGE_CACHE_TTL_MS) {
    return cached.result
  }

  if (isWorkerMode()) {
    if (provider !== DEFAULT_ACCOUNT_PROVIDER) {
      throw new Error(`worker mode does not serve account provider "${provider}"`)
    }
    const cfg = getWorkerConfig()
    if (!cfg) return { accounts: [] }
    const client = createUsageClient(cfg.masterUrl)
    const outcome = await client.fetchSnapshot()
    if (!outcome.ok) {
      logger.warn({ failure: outcome.failure.kind }, "claude-usage: worker fetch failed")
      return { accounts: [] }
    }
    const file = await loadAccounts()
    const result = snapshotToUsageResult(outcome.view, file.activeIds[provider])
    usageCaches.set(provider, { result, fetchedAt: Date.now() })
    return result
  }

  const descriptor = getAccountProvider(provider)
  const file = await loadAccounts()
  const auth = await descriptor.credentialAdapter.read()
  const pool = accountsOf(file, provider)

  const results: AccountUsage[] = []

  for (const account of pool) {
    const isActive = account.id === file.activeIds[provider]
    const base: AccountUsage = {
      id: account.id,
      label: account.label,
      active: isActive,
      excluded: account.excluded ?? false,
    }

    const resolved = await resolveAccess(account, isActive, auth, descriptor.refresh)
    if (resolved.needsReauth) base.needsReauth = true

    if (!resolved.access) {
      results.push({ ...base, error: resolved.error ?? "no access token" })
      continue
    }

    try {
      const usage = await descriptor.usage.fetch(resolved.access)
      results.push({ ...base, usage })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn({ accountId: account.id, error: msg }, "claude-usage: fetch failed")
      results.push({ ...base, error: msg })
    }
  }

  const result: UsageResult = { activeId: file.activeIds[provider], accounts: results }
  usageCaches.set(provider, { result, fetchedAt: Date.now() })
  return result
}

export function invalidateUsageCache(provider: ProviderId): void {
  usageCaches.delete(provider)
}

export function retagActiveInCache(provider: ProviderId, newActiveId: string): UsageResult | null {
  const cached = usageCaches.get(provider)
  if (!cached) return null
  const updated: UsageResult = {
    activeId: newActiveId,
    accounts: cached.result.accounts.map((a) => ({
      ...a,
      active: a.id === newActiveId || newActiveId.startsWith(a.id),
    })),
  }
  usageCaches.set(provider, { result: updated, fetchedAt: cached.fetchedAt })
  return updated
}

import { listAccountProviders } from "../lib/account-providers"
import type { UsageResponse } from "../lib/account-providers/types"
import { accountsOf, loadAccounts, type ProviderId } from "../lib/auth-files"
import { collectUsage, invalidateUsageCache } from "../lib/claude-usage"
import { SENTINEL_REFRESH } from "../lib/lease-constants"
import { logger } from "../middleware/logger"
import { ACCOUNT_POOL_USAGE_REFRESH_THROTTLE_MS, providerPoolLimits } from "./constants"
import { createCredentialResolver } from "./refresh"
import { createAccountPoolScheduler } from "./scheduler"
import { PoolStateStore, prunePoolState } from "./state"
import type { UsageSnapshotView, UsageWindowView } from "./types"

function windowsOf(usage: UsageResponse | undefined): UsageWindowView[] {
  if (!usage) return []
  const windows: UsageWindowView[] = []
  const add = (label: string, window: { utilization: number; resets_at?: string } | null | undefined): void => {
    if (!window) return
    windows.push({
      label,
      utilization: window.utilization,
      ...(window.resets_at ? { resetsAt: window.resets_at } : {}),
    })
  }
  add("5 小时", usage.five_hour)
  add("7 天", usage.seven_day)
  add("7 天 Sonnet", usage.seven_day_sonnet)
  add("7 天 Opus", usage.seven_day_opus)
  add("月", usage.monthly)
  for (const scoped of usage.scoped ?? []) add(scoped.label, scoped)
  return windows
}

export function createAccountPoolService(opts: { store?: PoolStateStore } = {}) {
  const store = opts.store ?? new PoolStateStore()
  const resolver = createCredentialResolver()
  const scheduler = createAccountPoolScheduler({
    store,
    listAccounts: async (provider) => accountsOf(await loadAccounts(), provider),
    resolveCredential: (provider, accountId) => resolver.resolve(provider, accountId),
  })
  const usageRefreshAt = new Map<ProviderId, number>()

  async function snapshot(provider: ProviderId): Promise<UsageSnapshotView> {
    const result = await collectUsage(provider, { skipRefresh: true })
    const file = await loadAccounts()
    const records = new Map(accountsOf(file, provider).map((account) => [account.id, account]))
    const accountIds = result.accounts.map((account) => account.id)
    const holders = await scheduler.holders(provider, accountIds)
    const cooling = await scheduler.cooling(accountIds)

    return {
      at: Date.now(),
      stale: false,
      accounts: result.accounts.map((account) => {
        const windows = windowsOf(account.usage)
        const record = records.get(account.id)
        return {
          provider,
          idPrefix: account.id.slice(0, 8),
          label: account.label,
          windows,
          hasUsage: windows.length > 0,
          coolingDown: cooling.has(account.id),
          excluded: account.excluded,
          needsReauth: account.needsReauth === true || record?.needsReauth === true,
          holders: holders.get(account.id) ?? [],
          ...(record?.expires !== undefined ? { expiresAt: record.expires } : {}),
        }
      }),
    }
  }

  return {
    acquire: scheduler.acquire,
    reportLimit: scheduler.reportLimit,

    snapshot,

    async refreshUsage(
      provider: ProviderId,
    ): Promise<{ ok: true; snapshot: UsageSnapshotView } | { ok: false; retryAfterMs: number }> {
      const now = Date.now()
      const last = usageRefreshAt.get(provider) ?? 0
      const elapsed = now - last
      if (elapsed < ACCOUNT_POOL_USAGE_REFRESH_THROTTLE_MS) {
        return { ok: false, retryAfterMs: ACCOUNT_POOL_USAGE_REFRESH_THROTTLE_MS - elapsed }
      }
      usageRefreshAt.set(provider, now)
      invalidateUsageCache(provider)
      return { ok: true, snapshot: await snapshot(provider) }
    },

    async start(): Promise<void> {
      await store.mutate((state) => prunePoolState(state, Date.now()))
      const limits = listAccountProviders().map((provider) => ({
        provider: provider.id,
        ...providerPoolLimits(provider.id),
      }))
      logger.info({ limits }, "account-pool: master service started")

      const file = await loadAccounts()
      const unusable = file.accounts.filter(
        (account) => account.refresh === SENTINEL_REFRESH || account.needsReauth === true,
      )
      if (unusable.length > 0) {
        logger.warn(
          { count: unusable.length, sample: unusable.slice(0, 5).map((account) => account.id.slice(0, 8)) },
          "account-pool: accounts are unusable until re-authenticated on this host",
        )
      }
    },

    async stop(): Promise<void> {
      await store.flush()
      logger.info("account-pool: state flushed")
    },
  }
}

export type AccountPoolService = ReturnType<typeof createAccountPoolService>

export const accountPoolService = createAccountPoolService()

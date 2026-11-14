import type { ProviderId, StoredAccount } from "../lib/auth-files"
import { SENTINEL_REFRESH } from "../lib/lease-constants"
import {
  ACCOUNT_POOL_ADOPTION_GRACE_MS,
  ACCOUNT_POOL_AFFINITY_TTL_MS,
  ACCOUNT_POOL_API_KEY_LEASE_TTL_MS,
  ACCOUNT_POOL_DEFAULT_COOLDOWN_MS,
  ACCOUNT_POOL_LEASE_MARGIN_MS,
  ACCOUNT_POOL_MIN_LEASE_REMAINING_MS,
  providerPoolLimits,
} from "./constants"
import { activeHolders, isCooling, type PoolStateStore, prunePoolState } from "./state"
import type { LeaseOutcome, LeaseRefusal, PoolCredential, PoolState, RateLimitReport } from "./types"

export type LeaseSelection = {
  workerId: string
  provider: ProviderId
  reason: "prelease" | "ratelimit"
  currentAccountId?: string
  preferredAccountIdPrefix?: string
  excludeAccountIds?: string[]
}

export type SchedulerDeps = {
  store: PoolStateStore
  listAccounts: (provider: ProviderId) => Promise<StoredAccount[]>
  resolveCredential: (provider: ProviderId, accountId: string) => Promise<PoolCredential>
  now?: () => number
}

function refusal(refused: LeaseRefusal, error: string): LeaseOutcome {
  return { ok: false, failure: { kind: "refused", refused, error } }
}

function noAccount(error: string): LeaseOutcome {
  return { ok: false, failure: { kind: "no-account", error } }
}

function unavailable(error: string): LeaseOutcome {
  return { ok: false, failure: { kind: "unavailable", error } }
}

export function createAccountPoolScheduler(deps: SchedulerDeps) {
  const nowOf = deps.now ?? (() => Date.now())

  function serve(
    state: PoolState,
    provider: ProviderId,
    workerId: string,
    account: StoredAccount,
    now: number,
  ): Promise<LeaseOutcome> | LeaseOutcome {
    return deps.resolveCredential(provider, account.id).then(
      (credential) => {
        const limits = providerPoolLimits(provider)
        const leaseExpiresAt =
          credential.type === "api"
            ? now + (limits.leaseTtlMs ?? ACCOUNT_POOL_API_KEY_LEASE_TTL_MS)
            : credential.expires - ACCOUNT_POOL_LEASE_MARGIN_MS

        if (leaseExpiresAt - now < ACCOUNT_POOL_MIN_LEASE_REMAINING_MS) {
          return unavailable("credential expires too soon")
        }

        state.leases[provider] ??= {}
        state.leases[provider][account.id] ??= {}
        state.leases[provider][account.id][workerId] = { expiresAt: leaseExpiresAt, updatedAt: now }
        state.affinity[workerId] ??= {}
        state.affinity[workerId][provider] = { accountId: account.id, at: now }
        state.workers[workerId] = now
        state.lastPicked[provider] = account.id

        return {
          ok: true,
          lease: { provider, accountId: account.id, credential, leaseExpiresAt },
        }
      },
      (err) => unavailable(err instanceof Error ? err.message : String(err)),
    )
  }

  function eligible(
    state: PoolState,
    account: StoredAccount,
    provider: ProviderId,
    workerId: string,
    now: number,
    excluded: Set<string>,
  ): boolean {
    if (account.excluded || account.needsReauth || account.refresh === SENTINEL_REFRESH) return false
    if (excluded.has(account.id)) return false
    if (isCooling(state, account.id, now)) return false
    const holders = activeHolders(state, provider, account.id, now).filter((holder) => holder !== workerId)
    return holders.length < providerPoolLimits(provider).maxHolders
  }

  return {
    acquire(selection: LeaseSelection): Promise<LeaseOutcome> {
      return deps.store.mutate(async (state) => {
        const now = nowOf()
        prunePoolState(state, now)
        state.workers[selection.workerId] = now

        const provider = selection.provider
        const accounts = await deps.listAccounts(provider)
        const byId = new Map(accounts.map((account) => [account.id, account]))

        if (selection.preferredAccountIdPrefix) {
          const matches = accounts.filter((account) => account.id.startsWith(selection.preferredAccountIdPrefix ?? ""))
          if (matches.length === 0) return refusal("unknown", "no account matches the requested prefix")
          if (matches.length > 1) return refusal("ambiguous", "the requested prefix matches multiple accounts")

          const account = matches[0]
          if (account.needsReauth || account.refresh === SENTINEL_REFRESH) {
            return refusal("needs-reauth", "account needs re-authentication")
          }
          if (isCooling(state, account.id, now)) return refusal("cooling", "account is rate-limited")
          const holders = activeHolders(state, provider, account.id, now).filter(
            (holder) => holder !== selection.workerId,
          )
          if (holders.length >= providerPoolLimits(provider).maxHolders) {
            return refusal("at-capacity", "account is at capacity")
          }
          return serve(state, provider, selection.workerId, account, now)
        }

        if (selection.reason === "ratelimit" && selection.currentAccountId) {
          const currentLease = state.leases[provider]?.[selection.currentAccountId]?.[selection.workerId]
          if (currentLease && now - currentLease.updatedAt <= ACCOUNT_POOL_ADOPTION_GRACE_MS) {
            const current = byId.get(selection.currentAccountId)
            if (
              current &&
              !current.needsReauth &&
              current.refresh !== SENTINEL_REFRESH &&
              !isCooling(state, current.id, now)
            ) {
              return serve(state, provider, selection.workerId, current, now)
            }
          }
        }

        let incumbentId: string | undefined
        if (selection.reason === "prelease") {
          incumbentId = selection.currentAccountId
          if (!incumbentId) {
            const affinity = state.affinity[selection.workerId]?.[provider]
            if (affinity && now - affinity.at <= ACCOUNT_POOL_AFFINITY_TTL_MS) incumbentId = affinity.accountId
          }
        }

        if (incumbentId) {
          const incumbent = byId.get(incumbentId)
          if (incumbent) {
            const holders = activeHolders(state, provider, incumbent.id, now).filter(
              (holder) => holder !== selection.workerId,
            )
            const usable =
              !incumbent.excluded &&
              !incumbent.needsReauth &&
              incumbent.refresh !== SENTINEL_REFRESH &&
              !isCooling(state, incumbent.id, now) &&
              holders.length < providerPoolLimits(provider).maxHolders
            if (usable) return serve(state, provider, selection.workerId, incumbent, now)
          }
        }

        const excluded = new Set(selection.excludeAccountIds ?? [])
        if (selection.reason === "ratelimit" && selection.currentAccountId) excluded.add(selection.currentAccountId)

        const candidates = accounts.filter((account) =>
          eligible(state, account, provider, selection.workerId, now, excluded),
        )
        if (candidates.length === 0) return noAccount("no account available")

        const holderCount = (account: StoredAccount): number =>
          activeHolders(state, provider, account.id, now).filter((holder) => holder !== selection.workerId).length
        const fewest = Math.min(...candidates.map(holderCount))
        const tier = candidates.filter((account) => holderCount(account) === fewest)

        const lastPicked = state.lastPicked[provider]
        const lastIndex = lastPicked ? tier.findIndex((account) => account.id === lastPicked) : -1
        const chosen = tier[(lastIndex + 1) % tier.length] ?? tier[0]
        return serve(state, provider, selection.workerId, chosen, now)
      })
    },

    async reportLimit(report: RateLimitReport): Promise<void> {
      await deps.store.mutate((state) => {
        const now = nowOf()
        prunePoolState(state, now)

        const currentLease = state.leases[report.provider]?.[report.accountId]?.[report.workerId]
        if (currentLease && now - currentLease.updatedAt <= ACCOUNT_POOL_ADOPTION_GRACE_MS) return

        const until =
          report.resetsAt !== undefined && report.resetsAt > now
            ? report.resetsAt
            : now + ACCOUNT_POOL_DEFAULT_COOLDOWN_MS
        state.cooldowns[report.accountId] = until
        state.workers[report.workerId] = now

        const providerLeases = state.leases[report.provider]
        const holders = providerLeases?.[report.accountId]
        if (providerLeases && holders) {
          delete holders[report.workerId]
          if (Object.keys(holders).length === 0) delete providerLeases[report.accountId]
          if (Object.keys(providerLeases).length === 0) delete state.leases[report.provider]
        }

        const workerAffinity = state.affinity[report.workerId]
        if (workerAffinity?.[report.provider]?.accountId === report.accountId) {
          delete workerAffinity[report.provider]
          if (Object.keys(workerAffinity).length === 0) delete state.affinity[report.workerId]
        }
      })
    },

    holders(provider: ProviderId, accountIds: string[]): Promise<Map<string, string[]>> {
      return deps.store.read((state) => {
        const now = nowOf()
        const result = new Map<string, string[]>()
        for (const accountId of accountIds) {
          result.set(accountId, activeHolders(state, provider, accountId, now))
        }
        return result
      })
    },

    cooling(accountIds: string[]): Promise<Map<string, number>> {
      return deps.store.read((state) => {
        const now = nowOf()
        const result = new Map<string, number>()
        for (const accountId of accountIds) {
          if (isCooling(state, accountId, now)) result.set(accountId, state.cooldowns[accountId])
        }
        return result
      })
    },
  }
}

export type AccountPoolScheduler = ReturnType<typeof createAccountPoolScheduler>

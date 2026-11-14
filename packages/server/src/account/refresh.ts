import { getAccountProvider } from "../lib/account-providers"
import { applyToken, loadAccounts, type ProviderId, saveAccounts, withAuthLock } from "../lib/auth-files"
import { SENTINEL_REFRESH } from "../lib/lease-constants"
import { RefreshRevokedError } from "../lib/token-refresh"
import { logger } from "../middleware/logger"
import { ACCOUNT_POOL_MIN_LEASE_REMAINING_MS, ACCOUNT_POOL_REFRESH_MIN_REMAINING_MS } from "./constants"
import type { PoolCredential } from "./types"

export class CredentialUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CredentialUnavailableError"
  }
}

function isRevoked(err: unknown): boolean {
  if (err instanceof RefreshRevokedError) return true
  const message = err instanceof Error ? err.message : String(err)
  return /invalid_grant|HTTP 400|HTTP 401/.test(message)
}

export function createCredentialResolver() {
  const inflight = new Map<string, Promise<PoolCredential>>()

  async function resolveNow(provider: ProviderId, accountId: string, minRemainingMs: number): Promise<PoolCredential> {
    return withAuthLock(async () => {
      const file = await loadAccounts()
      const account = file.accounts.find(
        (candidate) => candidate.id === accountId && (candidate.provider ?? "anthropic") === provider,
      )
      if (!account) throw new CredentialUnavailableError("account not found")
      if (account.needsReauth) throw new CredentialUnavailableError("account needs re-authentication")

      const descriptor = getAccountProvider(provider)

      if (descriptor.credentialAdapter.kind === "api-key") {
        const key = account.refresh
        if (!key || key === SENTINEL_REFRESH) throw new CredentialUnavailableError("account has no api key")
        return { type: "api", key }
      }

      const remaining = (account.expires ?? 0) - Date.now()
      if (account.access && account.expires && remaining > minRemainingMs) {
        return {
          type: "oauth",
          access: account.access,
          expires: account.expires,
          ...(account.accountId ? { accountId: account.accountId } : {}),
        }
      }

      if (!account.refresh || account.refresh === SENTINEL_REFRESH) {
        throw new CredentialUnavailableError("account has no refresh token")
      }

      try {
        const fresh = await descriptor.refresh.refresh(account.refresh)
        if (fresh.expires - Date.now() <= ACCOUNT_POOL_MIN_LEASE_REMAINING_MS) {
          throw new CredentialUnavailableError("refreshed credential expires too soon")
        }
        applyToken(account, fresh)
        await saveAccounts(file)
        return {
          type: "oauth",
          access: fresh.access,
          expires: fresh.expires,
          ...((fresh.accountId ?? account.accountId) ? { accountId: fresh.accountId ?? account.accountId } : {}),
        }
      } catch (err) {
        if (isRevoked(err)) {
          account.needsReauth = true
          await saveAccounts(file).catch((saveErr) => {
            logger.warn(
              { error: saveErr instanceof Error ? saveErr.message : String(saveErr) },
              "account-pool: failed to persist needsReauth",
            )
          })
        }
        const message = err instanceof Error ? err.message : String(err)
        throw new CredentialUnavailableError(`credential refresh failed: ${message}`)
      }
    })
  }

  return {
    resolve(
      provider: ProviderId,
      accountId: string,
      minRemainingMs = ACCOUNT_POOL_REFRESH_MIN_REMAINING_MS,
    ): Promise<PoolCredential> {
      const key = `${provider}:${accountId}`
      const existing = inflight.get(key)
      if (existing) return existing
      const promise = resolveNow(provider, accountId, minRemainingMs).finally(() => inflight.delete(key))
      inflight.set(key, promise)
      return promise
    },
  }
}

export type CredentialResolver = ReturnType<typeof createCredentialResolver>

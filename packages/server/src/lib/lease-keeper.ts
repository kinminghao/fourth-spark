import { LEASE_CHECK_INTERVAL_MS, LEASE_RENEW_BUFFER_MS, LEASE_BACKOFF_BASE_MS, LEASE_BACKOFF_CAP_MS } from "./lease-constants"
import { readAuthAnthropic, loadAccounts } from "./auth-files"
import { writeLease } from "./lease-writer"
import type { LeaseClient, LeaseFailure } from "./lease-client"
import { logger } from "../middleware/logger"

function backoffFor(priorFailures: number): number {
  return Math.min(LEASE_BACKOFF_BASE_MS * 2 ** priorFailures, LEASE_BACKOFF_CAP_MS)
}

function renewalDue(auth: { access?: string; expires?: number } | undefined): boolean {
  if (!auth?.access || !auth.expires) return true
  return auth.expires - Date.now() < LEASE_RENEW_BUFFER_MS
}

function stillUsable(auth: { access?: string; expires?: number } | undefined): boolean {
  if (!auth?.access || auth.expires === undefined) return false
  return auth.expires > Date.now()
}

function detailOf(failure: LeaseFailure): string {
  switch (failure.kind) {
    case "no-account": return "no-account"
    case "refused": return `refused:${failure.refused}`
    case "unreachable": return failure.detail
    case "bad-response": return failure.detail
  }
}

export function createLeaseKeeper(client: LeaseClient) {
  let failures = 0
  let disposed = false
  let ticking = false
  let heldAccountId: string | undefined

  async function renew(): Promise<LeaseFailure | undefined> {
    const outcome = await client.lease({
      reason: "prelease",
      ...(heldAccountId ? { currentAccountId: heldAccountId } : {}),
    })
    if (!outcome.ok) return outcome.failure

    const { lease } = outcome
    if (lease.expiresAt <= Date.now()) {
      logger.warn({ accountId: lease.accountId, expiresAt: lease.expiresAt }, "lease-keeper: master returned stale lease, rejecting")
      return { kind: "bad-response", detail: "stale expiresAt" }
    }

    if (disposed) return undefined

    await writeLease({ access: lease.access, expires: lease.expiresAt, accountId: lease.accountId })
    heldAccountId = lease.accountId
    failures = 0
    logger.info({ accountId: lease.accountId, expiresAt: lease.expiresAt }, "lease-keeper: renewed")
    return undefined
  }

  async function tickOnce(): Promise<void> {
    if (disposed || ticking) return
    ticking = true
    try {
      const auth = await readAuthAnthropic()
      if (!renewalDue(auth)) return

      const failure = await renew()
      if (!failure) return

      if (!stillUsable(auth)) {
        logger.error({ detail: detailOf(failure), expires: auth?.expires ?? 0 }, "lease-keeper: lease expired and renewal failed")
      }

      failures += 1
      await new Promise<void>((r) => setTimeout(r, backoffFor(failures - 1)))
    } finally {
      ticking = false
    }
  }

  const interval = setInterval(() => {
    void tickOnce().catch((err) => logger.warn({ error: err instanceof Error ? err.message : String(err) }, "lease-keeper: tick error"))
  }, LEASE_CHECK_INTERVAL_MS)
  interval.unref?.()

  logger.info({ checkMs: LEASE_CHECK_INTERVAL_MS, bufferMs: LEASE_RENEW_BUFFER_MS }, "lease-keeper: started")

  return {
    dispose() {
      disposed = true
      clearInterval(interval)
    },

    tickOnce,

    heldAccountId(): string | undefined {
      return heldAccountId
    },

    adoptAccount(accountId: string) {
      heldAccountId = accountId
    },

    async startup(): Promise<void> {
      const file = await loadAccounts()
      if (file.activeId) this.adoptAccount(file.activeId)
      await tickOnce()
    },
  }
}

export type LeaseKeeper = ReturnType<typeof createLeaseKeeper>

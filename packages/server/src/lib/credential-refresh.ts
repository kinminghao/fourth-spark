// ---------------------------------------------------------------------------
// Credential refresh — after the shared credential store changes, account-store
// runtimes rebuild their instance state so the new credential applies to
// running sessions without a process restart. Best-effort by contract: a
// runtime that is down must never fail the account operation.
// ---------------------------------------------------------------------------

import type { RuntimeProvider } from "../core/runtime-provider"
import { logger } from "../middleware/logger"

export async function refreshAccountStoreRuntimes(providers: Iterable<RuntimeProvider>): Promise<void> {
  const targets = [...providers].filter((provider) => provider.credentialChannel === "account-store")
  await Promise.all(
    targets.map(async (provider) => {
      try {
        await provider.refreshCredentials?.()
      } catch (err) {
        logger.warn({ err, runtimeId: provider.id }, "failed to refresh runtime credentials")
      }
    }),
  )
}

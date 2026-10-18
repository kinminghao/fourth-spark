// ---------------------------------------------------------------------------
// api-key onboarding — add a static api-key account for a provider that offers
// an ApiKeyLoginStrategy. Verification is provider-owned; this module only
// wires the verified key into the account pool and the shared auth.json.
// ---------------------------------------------------------------------------

import { logger } from "../middleware/logger"
import { getAccountProvider } from "./account-providers"
import type { ProviderId } from "./auth-files"
import { upsertAccountWithCredential } from "./claude-onboard"
import { invalidateUsageCache } from "./claude-usage"

export type AddApiKeyAccountResult =
  | { ok: true; id: string; label: string; existing: boolean }
  | { ok: false; reason: "unsupported-provider" | "invalid-key" | "unreachable" | "unexpected"; detail?: string }

export async function addApiKeyAccount(provider: ProviderId, key: string): Promise<AddApiKeyAccountResult> {
  const descriptor = getAccountProvider(provider)
  if (descriptor.login.kind !== "api-key") return { ok: false, reason: "unsupported-provider" }

  const normalizedKey = key.trim()
  const verified = await descriptor.login.verify(normalizedKey)
  if (!verified.ok) return verified

  const existing = await upsertAccountWithCredential(provider, verified.id, verified.label, {
    refresh: normalizedKey,
    access: normalizedKey,
  })
  invalidateUsageCache(provider)

  logger.info({ provider, id: verified.id, label: verified.label, existing }, "api-key account added")
  return { ok: true, id: verified.id, label: verified.label, existing }
}

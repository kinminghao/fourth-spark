import { listAccountProviders } from "../lib/account-providers"
import type { ProviderId } from "../lib/auth-files"

export function poolProviderIds(): Set<ProviderId> {
  const registered = listAccountProviders().map((provider) => provider.id)
  const raw = process.env.ACCOUNT_POOL_PROVIDERS?.trim()
  if (!raw) return new Set(registered)
  const requested = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
  return new Set(requested.filter((id) => registered.includes(id)))
}

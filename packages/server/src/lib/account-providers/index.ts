// ---------------------------------------------------------------------------
// Account provider registry — resolves an AccountProviderDescriptor by id.
// Adding a provider means creating its descriptor module and registering it
// here; core account flows pick it up without further changes.
// ---------------------------------------------------------------------------

import type { ProviderId } from "../auth-files"
import { anthropicAccountProvider } from "./anthropic"
import { openAiAccountProvider } from "./openai"
import { openCodeGoAccountProvider } from "./opencode-go"
import type { AccountProviderDescriptor } from "./types"

const providers = new Map<ProviderId, AccountProviderDescriptor>([
  [anthropicAccountProvider.id, anthropicAccountProvider],
  [openCodeGoAccountProvider.id, openCodeGoAccountProvider],
  [openAiAccountProvider.id, openAiAccountProvider],
])

// The account surface (usage page, local/cloud pools) currently operates on
// Claude accounts only.
export const DEFAULT_ACCOUNT_PROVIDER: ProviderId = anthropicAccountProvider.id

export function registerAccountProvider(provider: AccountProviderDescriptor): void {
  providers.set(provider.id, provider)
}

export function getAccountProvider(id: ProviderId): AccountProviderDescriptor {
  const provider = providers.get(id)
  if (!provider) throw new Error(`account provider not registered: ${id}`)
  return provider
}

export function listAccountProviders(): AccountProviderDescriptor[] {
  return Array.from(providers.values())
}

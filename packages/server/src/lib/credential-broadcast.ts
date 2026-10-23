// ---------------------------------------------------------------------------
// Credential broadcast — pushes a token to every runtime whose credential
// channel requires an explicit push ("runtime-push"). Runtimes on the
// "account-store" channel read the shared auth.json directly and are skipped.
// ---------------------------------------------------------------------------

import { consumesCredentialProvider, type RuntimeProvider } from "../core/runtime-provider"
import { logger } from "../middleware/logger"
import type { ProviderId, TokenWrite } from "./auth-files"

export async function pushCredentialToProviders(
  providers: Iterable<RuntimeProvider>,
  accountProvider: ProviderId,
  token: TokenWrite,
): Promise<void> {
  for (const provider of providers) {
    if (!consumesCredentialProvider(provider, accountProvider)) continue
    await provider.credentialWriter.write(token).catch((err) => {
      logger.warn({ err, runtimeId: provider.id }, "failed to push credential to runtime")
    })
  }
}

export async function broadcastCredentialToRuntimes(accountProvider: ProviderId, token: TokenWrite): Promise<void> {
  try {
    const { getRegistry } = await import("../core/registry")
    await pushCredentialToProviders(getRegistry().providers.values(), accountProvider, token)
  } catch {}
}

import { logger } from "../middleware/logger"
import { DEFAULT_ACCOUNT_PROVIDER, getAccountProvider } from "./account-providers"
import { recordActiveId } from "./auth-files"
import { broadcastCredentialToRuntimes } from "./credential-broadcast"

export async function writeLease(input: { access: string; expires: number; accountId: string }): Promise<void> {
  const { credentialAdapter } = getAccountProvider(DEFAULT_ACCOUNT_PROVIDER)
  await credentialAdapter.write({ kind: "lease", access: input.access, expires: input.expires })
  await broadcastCredentialToRuntimes({ kind: "lease", access: input.access, expires: input.expires })
  try {
    await recordActiveId(DEFAULT_ACCOUNT_PROVIDER, input.accountId)
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, "lease-writer: failed to record activeId")
  }
}

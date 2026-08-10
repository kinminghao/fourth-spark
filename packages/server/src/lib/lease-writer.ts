import { writeAuthAnthropic, recordLeasedActiveId } from "./auth-files"
import { logger } from "../middleware/logger"

async function broadcastLeaseToOtherRuntimes(access: string, expires: number): Promise<void> {
  try {
    const { getRegistry } = await import("../core/registry")
    for (const provider of getRegistry().providers.values()) {
      if (provider.id === "opencode") continue
      await provider.credentialWriter.write({ kind: "lease", access, expires }).catch(() => {})
    }
  } catch {}
}

export async function writeLease(input: { access: string; expires: number; accountId: string }): Promise<void> {
  await writeAuthAnthropic({ kind: "lease", access: input.access, expires: input.expires })
  await broadcastLeaseToOtherRuntimes(input.access, input.expires)
  try {
    await recordLeasedActiveId(input.accountId)
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, "lease-writer: failed to record activeId")
  }
}

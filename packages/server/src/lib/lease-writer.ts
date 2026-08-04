import { writeAuthAnthropic, recordLeasedActiveId } from "./auth-files"
import { logger } from "../middleware/logger"

export async function writeLease(input: { access: string; expires: number; accountId: string }): Promise<void> {
  await writeAuthAnthropic({ kind: "lease", access: input.access, expires: input.expires })
  try {
    await recordLeasedActiveId(input.accountId)
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, "lease-writer: failed to record activeId")
  }
}

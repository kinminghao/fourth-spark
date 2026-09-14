import type { AccountPool, AcquireResult } from "../core/types"
import { autoSwitch, clearCooldown, getActiveId, markCooldown, parseResetMsFromMessage } from "./account-switcher"

export const localAccountPool: AccountPool = {
  async acquire(ctx): Promise<AcquireResult> {
    const result = await autoSwitch(ctx.currentAccountId)
    if (result.switched) {
      return { ok: true, accountId: result.to, credential: null }
    }
    return { ok: false, reason: result.reason }
  },

  async reportLimit(ctx): Promise<void> {
    const resetMs = parseResetMsFromMessage(ctx.message)
    markCooldown(ctx.accountId, resetMs)
  },

  async release(accountId: string): Promise<void> {
    clearCooldown(accountId)
  },

  async getActiveId(): Promise<string | undefined> {
    return getActiveId()
  },
}

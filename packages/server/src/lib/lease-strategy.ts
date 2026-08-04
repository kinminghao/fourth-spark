import type { LeaseClient, LeaseFailure } from "./lease-client"
import { writeLease } from "./lease-writer"
import { parseResetMsFromMessage } from "./account-switcher"
import { logger } from "../middleware/logger"

const FAILURE_MESSAGES: Record<LeaseFailure["kind"], string> = {
  "no-account": "云端账号池暂无可用账号",
  unreachable: "连不上云端账号池，无法切号",
  "bad-response": "云端账号池返回了无法识别的响应",
  refused: "云端账号池拒绝了本次租借请求",
}

export function createLeaseStrategy(client: LeaseClient) {
  async function onLimit(ctx: { accountId: string; message?: string }): Promise<boolean> {
    const resetsAt = parseResetMsFromMessage(ctx.message)
    await client.reportRateLimit({ accountId: ctx.accountId, headers: {}, resetsAt })

    const outcome = await client.lease({ reason: "ratelimit", currentAccountId: ctx.accountId })
    if (!outcome.ok) {
      logger.warn({ accountId: ctx.accountId, failure: outcome.failure.kind }, "lease-strategy: onLimit lease failed")
      return false
    }

    const { lease } = outcome
    if (lease.expiresAt <= Date.now()) {
      logger.warn({ accountId: lease.accountId, expiresAt: lease.expiresAt }, "lease-strategy: onLimit stale lease rejected")
      return false
    }

    await writeLease({ access: lease.access, expires: lease.expiresAt, accountId: lease.accountId })
    logger.info({ from: ctx.accountId, to: lease.accountId, expiresAt: lease.expiresAt }, "lease-strategy: switched via master")
    return true
  }

  async function onStaleLease(ctx: { accountId: string }): Promise<boolean> {
    const outcome = await client.lease({ reason: "prelease", currentAccountId: ctx.accountId })
    if (!outcome.ok) {
      logger.warn({ accountId: ctx.accountId, failure: outcome.failure.kind }, "lease-strategy: onStaleLease failed")
      return false
    }

    const { lease } = outcome
    if (lease.expiresAt <= Date.now()) {
      logger.warn({ accountId: lease.accountId, expiresAt: lease.expiresAt }, "lease-strategy: stale re-lease rejected")
      return false
    }

    await writeLease({ access: lease.access, expires: lease.expiresAt, accountId: lease.accountId })
    logger.info({ accountId: lease.accountId, expiresAt: lease.expiresAt }, "lease-strategy: re-leased after 401")
    return true
  }

  function failureMessage(failure: LeaseFailure): string {
    return FAILURE_MESSAGES[failure.kind]
  }

  return { onLimit, onStaleLease, failureMessage }
}

export type LeaseStrategy = ReturnType<typeof createLeaseStrategy>

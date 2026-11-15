import { Hono } from "hono"
import { DEFAULT_ACCOUNT_PROVIDER, getAccountProvider } from "../lib/account-providers"
import type { ProviderId } from "../lib/auth-files"
import { logger } from "../middleware/logger"
import { poolProviderIds } from "./providers"
import { type AccountPoolService, accountPoolService } from "./service"
import type { LeaseOutcome, LeaseRequest } from "./types"

export type AccountPoolRouteService = Pick<AccountPoolService, "acquire" | "reportLimit" | "snapshot" | "refreshUsage">

const WORKER_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRegisteredProvider(id: string): boolean {
  try {
    getAccountProvider(id)
    return true
  } catch {
    return false
  }
}

function optionalString(raw: Record<string, unknown>, key: string): string | undefined | null {
  const value = raw[key]
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.length === 0) return null
  return value
}

export function parseLeaseRequest(raw: unknown): Parsed<LeaseRequest & { provider: ProviderId }> {
  if (!isRecord(raw)) return { ok: false, error: "malformed lease request" }

  const workerId = raw.workerId
  if (typeof workerId !== "string" || !WORKER_ID_PATTERN.test(workerId)) {
    return { ok: false, error: "malformed lease request" }
  }

  const reason = raw.reason
  if (reason !== "prelease" && reason !== "ratelimit") return { ok: false, error: "malformed lease request" }

  const protocolVersion = raw.protocolVersion
  if (protocolVersion !== undefined && protocolVersion !== 2) {
    return { ok: false, error: "unsupported protocolVersion" }
  }

  const currentAccountId = optionalString(raw, "currentAccountId")
  if (currentAccountId === null) return { ok: false, error: "malformed lease request" }
  const preferredAccountIdPrefix = optionalString(raw, "preferredAccountIdPrefix")
  if (preferredAccountIdPrefix === null) return { ok: false, error: "malformed lease request" }

  if (protocolVersion !== 2) {
    if (raw.provider !== undefined) return { ok: false, error: "protocolVersion 2 is required to select a provider" }
    if (raw.excludeAccountIds !== undefined || raw.pinned !== undefined) {
      return { ok: false, error: "protocolVersion 2 is required for this field" }
    }
    return {
      ok: true,
      value: {
        workerId,
        reason,
        provider: DEFAULT_ACCOUNT_PROVIDER,
        ...(currentAccountId ? { currentAccountId } : {}),
        ...(preferredAccountIdPrefix ? { preferredAccountIdPrefix } : {}),
      } as LeaseRequest & { provider: ProviderId },
    }
  }

  const provider = raw.provider
  if (typeof provider !== "string" || !isRegisteredProvider(provider)) {
    return { ok: false, error: "unknown or missing provider" }
  }

  const excludeAccountIds = raw.excludeAccountIds
  if (
    excludeAccountIds !== undefined &&
    (!Array.isArray(excludeAccountIds) || !excludeAccountIds.every((id) => typeof id === "string"))
  ) {
    return { ok: false, error: "malformed lease request" }
  }

  const pinned = raw.pinned
  if (pinned !== undefined && typeof pinned !== "boolean") return { ok: false, error: "malformed lease request" }
  if (pinned === true && !preferredAccountIdPrefix) {
    return { ok: false, error: "pinned requires preferredAccountIdPrefix" }
  }

  return {
    ok: true,
    value: {
      workerId,
      reason,
      protocolVersion: 2,
      provider,
      ...(currentAccountId ? { currentAccountId } : {}),
      ...(preferredAccountIdPrefix ? { preferredAccountIdPrefix } : {}),
      ...(excludeAccountIds ? { excludeAccountIds: excludeAccountIds as string[] } : {}),
      ...(pinned !== undefined ? { pinned } : {}),
    },
  }
}

export type ParsedRateLimit = {
  workerId: string
  accountId: string
  provider: ProviderId
  resetsAt?: number
}

export function parseRateLimitRequest(raw: unknown): Parsed<ParsedRateLimit> {
  if (!isRecord(raw)) return { ok: false, error: "malformed ratelimit report" }

  const workerId = raw.workerId
  if (typeof workerId !== "string" || !WORKER_ID_PATTERN.test(workerId)) {
    return { ok: false, error: "malformed ratelimit report" }
  }
  const accountId = raw.accountId
  if (typeof accountId !== "string" || accountId.length === 0) {
    return { ok: false, error: "malformed ratelimit report" }
  }

  const protocolVersion = raw.protocolVersion
  if (protocolVersion !== undefined && protocolVersion !== 2) {
    return { ok: false, error: "unsupported protocolVersion" }
  }

  let provider: ProviderId = DEFAULT_ACCOUNT_PROVIDER
  if (protocolVersion === 2) {
    const rawProvider = raw.provider
    if (typeof rawProvider !== "string" || !isRegisteredProvider(rawProvider)) {
      return { ok: false, error: "unknown or missing provider" }
    }
    provider = rawProvider
  } else if (raw.provider !== undefined) {
    return { ok: false, error: "protocolVersion 2 is required to select a provider" }
  }

  const resetsAt = raw.resetsAt
  if (resetsAt !== undefined && (typeof resetsAt !== "number" || !Number.isFinite(resetsAt))) {
    return { ok: false, error: "malformed ratelimit report" }
  }

  return {
    ok: true,
    value: {
      workerId,
      accountId,
      provider,
      ...(typeof resetsAt === "number" ? { resetsAt } : {}),
    },
  }
}

function primarySecret(outcome: Extract<LeaseOutcome, { ok: true }>): string {
  return outcome.lease.credential.type === "oauth" ? outcome.lease.credential.access : outcome.lease.credential.key
}

function failureStatus(outcome: Extract<LeaseOutcome, { ok: false }>, v2: boolean): 400 | 409 | 503 {
  const failure = outcome.failure
  if (failure.kind === "bad-request") return 400
  if (failure.kind === "refused") {
    if (failure.refused === "at-capacity" && !v2) return 503
    return 409
  }
  return 503
}

function failureBody(outcome: Extract<LeaseOutcome, { ok: false }>, v2: boolean): Record<string, unknown> {
  const failure = outcome.failure
  if (failure.kind === "refused") {
    if (failure.refused === "at-capacity" && !v2) return { error: "no account available" }
    return { error: failure.error, refused: failure.refused }
  }
  return { error: failure.error }
}

export function createAccountPoolRoutes(
  service: AccountPoolRouteService,
  allowedProviders: Set<ProviderId> = poolProviderIds(),
): Hono {
  const app = new Hono()

  app.get("/v1/health", (c) => c.json({ ok: true }))

  app.post("/v1/lease", async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: "malformed lease request" }, 400)
    }

    const parsed = parseLeaseRequest(raw)
    if (!parsed.ok) return c.json({ error: parsed.error }, 400)

    const request = parsed.value
    const v2 = request.protocolVersion === 2
    if (!allowedProviders.has(request.provider)) {
      return c.json({ error: `provider not enabled: ${request.provider}` }, 400)
    }
    try {
      const outcome = await service.acquire({
        workerId: request.workerId,
        provider: request.provider,
        reason: request.reason,
        ...(request.currentAccountId ? { currentAccountId: request.currentAccountId } : {}),
        ...(request.preferredAccountIdPrefix ? { preferredAccountIdPrefix: request.preferredAccountIdPrefix } : {}),
        ...(request.excludeAccountIds ? { excludeAccountIds: request.excludeAccountIds } : {}),
      })

      c.header("Cache-Control", "no-store")
      if (!outcome.ok) {
        return c.json(failureBody(outcome, v2), failureStatus(outcome, v2))
      }

      const secret = primarySecret(outcome)
      if (!v2) {
        return c.json({
          accountId: outcome.lease.accountId,
          access: secret,
          expiresAt: outcome.lease.leaseExpiresAt,
        })
      }

      return c.json({
        provider: outcome.lease.provider,
        accountId: outcome.lease.accountId,
        access: secret,
        expiresAt:
          outcome.lease.credential.type === "oauth" ? outcome.lease.credential.expires : outcome.lease.leaseExpiresAt,
        leaseExpiresAt: outcome.lease.leaseExpiresAt,
        credential: outcome.lease.credential,
      })
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, "account-pool: lease failed")
      return c.json({ error: "account pool unavailable" }, 503)
    }
  })

  app.post("/v1/ratelimit", async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: "malformed ratelimit report" }, 400)
    }

    const parsed = parseRateLimitRequest(raw)
    if (!parsed.ok) return c.json({ error: parsed.error }, 400)
    if (!allowedProviders.has(parsed.value.provider)) {
      return c.json({ error: `provider not enabled: ${parsed.value.provider}` }, 400)
    }

    try {
      await service.reportLimit(parsed.value)
      return c.body(null, 204)
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, "account-pool: ratelimit failed")
      return c.json({ error: "account pool unavailable" }, 503)
    }
  })

  app.get("/v1/usage", async (c) => {
    const provider = c.req.query("provider") ?? DEFAULT_ACCOUNT_PROVIDER
    if (!isRegisteredProvider(provider)) return c.json({ error: `unknown account provider: ${provider}` }, 400)
    if (!allowedProviders.has(provider)) return c.json({ error: `provider not enabled: ${provider}` }, 400)
    try {
      c.header("Cache-Control", "no-store")
      return c.json(await service.snapshot(provider))
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, "account-pool: usage failed")
      return c.json({ error: "account pool unavailable" }, 503)
    }
  })

  app.post("/v1/usage/refresh", async (c) => {
    const provider = c.req.query("provider") ?? DEFAULT_ACCOUNT_PROVIDER
    if (!isRegisteredProvider(provider)) return c.json({ error: `unknown account provider: ${provider}` }, 400)
    if (!allowedProviders.has(provider)) return c.json({ error: `provider not enabled: ${provider}` }, 400)
    try {
      const result = await service.refreshUsage(provider)
      c.header("Cache-Control", "no-store")
      if (!result.ok) {
        c.header("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)))
        return c.json({ error: "refresh throttled", retryAfterMs: result.retryAfterMs }, 429)
      }
      return c.json(result.snapshot)
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, "account-pool: usage refresh failed")
      return c.json({ error: "account pool unavailable" }, 503)
    }
  })

  app.get("/v1/usage/refresh", (c) => c.json({ error: "use POST" }, 405))

  app.all("/v1/*", (c) => c.json({ error: "not found" }, 404))

  return app
}

export const accountPoolRoutes = createAccountPoolRoutes(accountPoolService)

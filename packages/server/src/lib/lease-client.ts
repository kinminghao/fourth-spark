import { CLOUD_ROUTES, LEASE_BACKOFF_BASE_MS, LEASE_BACKOFF_CAP_MS, NETWORK_TIMEOUT_MS } from "./lease-constants"
import { logger } from "../middleware/logger"

// --- Wire types (aligned with claude-accounts-pool/src/cloud/protocol.ts) ---

type LeaseReason = "prelease" | "ratelimit"

type LeaseRequest = {
  workerId: string
  reason: LeaseReason
  currentAccountId?: string
  preferredAccountIdPrefix?: string
}

export type LeaseResponse = {
  accountId: string
  access: string
  expiresAt: number
}

type RateLimitReport = {
  workerId: string
  accountId: string
  headers: Record<string, string>
  resetsAt?: number
}

export type LeaseRefusal = "unknown" | "ambiguous" | "cooling" | "needs-reauth"

export type LeaseFailure =
  | { kind: "no-account" }
  | { kind: "refused"; refused: LeaseRefusal }
  | { kind: "unreachable"; detail: string }
  | { kind: "bad-response"; detail: string }

export type LeaseOutcome =
  | { ok: true; lease: LeaseResponse }
  | { ok: false; failure: LeaseFailure }

// --- Helpers ---

const MAX_LEASE_ATTEMPTS = 8

const REFUSALS: Record<LeaseRefusal, true> = { unknown: true, ambiguous: true, cooling: true, "needs-reauth": true }

function backoffFor(attempt: number): number {
  return Math.min(LEASE_BACKOFF_BASE_MS * 2 ** attempt, LEASE_BACKOFF_CAP_MS)
}

function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function redact(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function parseRefusal(body: string): LeaseRefusal | undefined {
  try {
    const val = (JSON.parse(body) as Record<string, unknown>)?.["refused"]
    if (typeof val === "string" && Object.hasOwn(REFUSALS, val)) return val as LeaseRefusal
  } catch { /* not json */ }
  return undefined
}

function parseLease(raw: unknown): LeaseResponse | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.accountId !== "string" || r.accountId.length === 0) return undefined
  if (typeof r.access !== "string" || r.access.length === 0) return undefined
  if (typeof r.expiresAt !== "number" || !Number.isFinite(r.expiresAt)) return undefined
  return { accountId: r.accountId, access: r.access, expiresAt: r.expiresAt }
}

type Attempt =
  | { retry: false; outcome: LeaseOutcome }
  | { retry: true; detail: string }

// --- Client ---

export function createLeaseClient(masterUrl: string, workerId: string) {
  const base = masterUrl.replace(/\/+$/, "")

  function post(route: string, body: unknown): Promise<Response> {
    return fetch(`${base}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    })
  }

  async function attemptLease(payload: LeaseRequest): Promise<Attempt> {
    let res: Response
    try {
      res = await post(CLOUD_ROUTES.lease, payload)
    } catch (err) {
      return { retry: true, detail: errorMsg(err) }
    }

    if (res.status === 503) {
      logger.warn({ status: 503 }, "lease: master has no account available")
      return { retry: false, outcome: { ok: false, failure: { kind: "no-account" } } }
    }

    const text = await res.text().catch(() => "")

    if (res.status === 409) {
      const refused = parseRefusal(text)
      if (!refused) {
        return { retry: false, outcome: { ok: false, failure: { kind: "bad-response", detail: `409: ${redact(text)}` } } }
      }
      logger.warn({ refused }, "lease: master refused named account")
      return { retry: false, outcome: { ok: false, failure: { kind: "refused", refused } } }
    }

    if (res.status >= 500) {
      return { retry: true, detail: `HTTP ${res.status}: ${redact(text)}` }
    }

    if (!res.ok) {
      return { retry: false, outcome: { ok: false, failure: { kind: "bad-response", detail: `HTTP ${res.status}: ${redact(text)}` } } }
    }

    let raw: unknown
    try { raw = JSON.parse(text) } catch {
      return { retry: false, outcome: { ok: false, failure: { kind: "bad-response", detail: `unparseable: ${redact(text)}` } } }
    }

    const lease = parseLease(raw)
    if (!lease) {
      return { retry: false, outcome: { ok: false, failure: { kind: "bad-response", detail: `schema-invalid: ${redact(text)}` } } }
    }

    logger.info({ accountId: lease.accountId, expiresAt: lease.expiresAt }, "lease: granted")
    return { retry: false, outcome: { ok: true, lease } }
  }

  return {
    async lease(input: {
      reason: LeaseReason
      currentAccountId?: string
      preferredAccountIdPrefix?: string
      attempts?: number
    }): Promise<LeaseOutcome> {
      const payload: LeaseRequest = {
        workerId,
        reason: input.reason,
        ...(input.currentAccountId ? { currentAccountId: input.currentAccountId } : {}),
        ...(input.preferredAccountIdPrefix ? { preferredAccountIdPrefix: input.preferredAccountIdPrefix } : {}),
      }
      const maxAttempts = input.attempts ?? MAX_LEASE_ATTEMPTS
      let detail = "no attempt made"

      for (let i = 0; i < maxAttempts; i++) {
        const result = await attemptLease(payload)
        if (!result.retry) return result.outcome
        detail = result.detail
        if (i < maxAttempts - 1) {
          await new Promise<void>((r) => setTimeout(r, backoffFor(i)))
        }
      }

      logger.error({ attempts: maxAttempts, detail }, "lease: exhausted all attempts")
      return { ok: false, failure: { kind: "unreachable", detail } }
    },

    async reportRateLimit(input: { accountId: string; headers: Record<string, string>; resetsAt?: number }): Promise<boolean> {
      const payload: RateLimitReport = {
        workerId,
        accountId: input.accountId,
        headers: input.headers,
        ...(input.resetsAt !== undefined ? { resetsAt: input.resetsAt } : {}),
      }
      try {
        const res = await post(CLOUD_ROUTES.ratelimit, payload)
        if (!res.ok) {
          logger.warn({ status: res.status }, "lease: ratelimit report rejected")
          return false
        }
        logger.info({ accountId: input.accountId }, "lease: ratelimit reported")
        return true
      } catch (err) {
        logger.warn({ error: errorMsg(err) }, "lease: ratelimit report failed")
        return false
      }
    },

    async healthCheck(): Promise<boolean> {
      try {
        const res = await fetch(`${base}${CLOUD_ROUTES.health}`, {
          signal: AbortSignal.timeout(5_000),
        })
        return res.ok
      } catch {
        return false
      }
    },
  }
}

export type LeaseClient = ReturnType<typeof createLeaseClient>

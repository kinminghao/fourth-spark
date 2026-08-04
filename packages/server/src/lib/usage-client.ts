import { CLOUD_ROUTES, NETWORK_TIMEOUT_MS } from "./lease-constants"
import { logger } from "../middleware/logger"

export type UsageWindowView = {
  label: string
  utilization: number
  resetsAt?: string
}

export type UsageAccountView = {
  idPrefix: string
  label: string
  windows: UsageWindowView[]
  hasUsage: boolean
  coolingDown: boolean
  excluded: boolean
  needsReauth: boolean
  expiresAt?: number
}

export type UsageSnapshotView = {
  at: number
  stale: boolean
  accounts: UsageAccountView[]
}

export type UsageFetchFailure =
  | { kind: "unreachable"; detail: string }
  | { kind: "http"; detail: string }
  | { kind: "bad-response"; detail: string }
  | { kind: "throttled"; retryAfterMs?: number }

export type UsageFetchOutcome =
  | { ok: true; view: UsageSnapshotView }
  | { ok: false; failure: UsageFetchFailure }

function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function redact(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function parseWindow(raw: unknown): UsageWindowView | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.label !== "string") return undefined
  if (typeof r.utilization !== "number" || !Number.isFinite(r.utilization)) return undefined
  if (r.resetsAt !== undefined && typeof r.resetsAt !== "string") return undefined
  return { label: r.label, utilization: r.utilization, ...(typeof r.resetsAt === "string" ? { resetsAt: r.resetsAt } : {}) }
}

function parseAccount(raw: unknown): UsageAccountView | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.idPrefix !== "string" || typeof r.label !== "string") return undefined
  if (typeof r.hasUsage !== "boolean" || typeof r.coolingDown !== "boolean") return undefined
  if (typeof r.excluded !== "boolean" || typeof r.needsReauth !== "boolean") return undefined
  if (!Array.isArray(r.windows)) return undefined
  const windows: UsageWindowView[] = []
  for (const w of r.windows) {
    const parsed = parseWindow(w)
    if (!parsed) return undefined
    windows.push(parsed)
  }
  if (r.expiresAt !== undefined && (typeof r.expiresAt !== "number" || !Number.isFinite(r.expiresAt))) return undefined
  return {
    idPrefix: r.idPrefix, label: r.label, windows, hasUsage: r.hasUsage,
    coolingDown: r.coolingDown, excluded: r.excluded, needsReauth: r.needsReauth,
    ...(typeof r.expiresAt === "number" ? { expiresAt: r.expiresAt } : {}),
  }
}

function parseSnapshot(raw: unknown): UsageSnapshotView | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.at !== "number" || !Number.isFinite(r.at)) return undefined
  if (typeof r.stale !== "boolean") return undefined
  if (!Array.isArray(r.accounts)) return undefined
  const accounts: UsageAccountView[] = []
  for (const a of r.accounts) {
    const parsed = parseAccount(a)
    if (!parsed) return undefined
    accounts.push(parsed)
  }
  return { at: r.at, stale: r.stale, accounts }
}

export function createUsageClient(masterUrl: string) {
  const base = masterUrl.replace(/\/+$/, "")

  async function requestSnapshot(path: string, init?: RequestInit): Promise<UsageFetchOutcome> {
    let res: Response
    try {
      res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) })
    } catch (err) {
      logger.warn({ detail: errorMsg(err) }, "usage-client: unreachable")
      return { ok: false, failure: { kind: "unreachable", detail: errorMsg(err) } }
    }

    const text = await res.text().catch(() => "")

    if (res.status === 429) {
      let retryAfterMs: number | undefined
      try {
        const val = (JSON.parse(text) as Record<string, unknown>)?.["retryAfterMs"]
        if (typeof val === "number" && Number.isFinite(val) && val > 0) retryAfterMs = val
      } catch { /* not json */ }
      return { ok: false, failure: { kind: "throttled", ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) } }
    }

    if (!res.ok) {
      return { ok: false, failure: { kind: "http", detail: `HTTP ${res.status}: ${redact(text)}` } }
    }

    let raw: unknown
    try { raw = JSON.parse(text) } catch {
      return { ok: false, failure: { kind: "bad-response", detail: `unparseable: ${redact(text)}` } }
    }

    const view = parseSnapshot(raw)
    if (!view) {
      logger.warn("usage-client: schema-invalid response")
      return { ok: false, failure: { kind: "bad-response", detail: `schema-invalid: ${redact(text)}` } }
    }

    return { ok: true, view }
  }

  return {
    fetchSnapshot(): Promise<UsageFetchOutcome> {
      return requestSnapshot(CLOUD_ROUTES.usage)
    },
    refreshSnapshot(): Promise<UsageFetchOutcome> {
      return requestSnapshot(CLOUD_ROUTES.usageRefresh, { method: "POST" })
    },
  }
}

export type UsageClient = ReturnType<typeof createUsageClient>

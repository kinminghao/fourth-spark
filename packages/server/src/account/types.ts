import type { ProviderId } from "../lib/auth-files"

export type LeaseReason = "prelease" | "ratelimit"

export type LeaseRequest = {
  workerId: string
  reason: LeaseReason
  protocolVersion?: 2
  provider?: ProviderId
  currentAccountId?: string
  preferredAccountIdPrefix?: string
  excludeAccountIds?: string[]
  pinned?: boolean
}

export type PoolCredential =
  | { type: "oauth"; access: string; expires: number; accountId?: string }
  | { type: "api"; key: string }

export type Lease = {
  provider: ProviderId
  accountId: string
  credential: PoolCredential
  leaseExpiresAt: number
}

export type LeaseRefusal = "unknown" | "ambiguous" | "cooling" | "needs-reauth" | "at-capacity"

export type LeaseFailure =
  | { kind: "bad-request"; error: string }
  | { kind: "refused"; refused: LeaseRefusal; error: string }
  | { kind: "no-account"; error: string }
  | { kind: "unavailable"; error: string }

export type LeaseOutcome = { ok: true; lease: Lease } | { ok: false; failure: LeaseFailure }

export type RateLimitReport = {
  workerId: string
  provider: ProviderId
  accountId: string
  resetsAt?: number
}

export type UsageWindowView = {
  label: string
  utilization: number
  resetsAt?: string
}

export type UsageAccountView = {
  provider: ProviderId
  idPrefix: string
  label: string
  windows: UsageWindowView[]
  hasUsage: boolean
  coolingDown: boolean
  excluded: boolean
  needsReauth: boolean
  holders: string[]
  expiresAt?: number
}

export type UsageSnapshotView = {
  at: number
  stale: boolean
  accounts: UsageAccountView[]
}

export type StoredLease = {
  expiresAt: number
  updatedAt: number
}

export type AffinityEntry = {
  accountId: string
  at: number
}

export type PoolState = {
  version: number
  leases: Record<ProviderId, Record<string, Record<string, StoredLease>>>
  cooldowns: Record<string, number>
  affinity: Record<string, Record<ProviderId, AffinityEntry>>
  workers: Record<string, number>
  lastPicked: Record<ProviderId, string>
}

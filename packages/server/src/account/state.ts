import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { ProviderId } from "../lib/auth-files"
import { ACCOUNT_POOL_AFFINITY_TTL_MS, ACCOUNT_POOL_STATE_VERSION } from "./constants"
import type { PoolState, StoredLease } from "./types"

export const ACCOUNT_POOL_STATE_PATH =
  process.env.ACCOUNT_POOL_STATE_PATH ?? join(homedir(), ".fourth-spark", "account-pool-state.json")

export function emptyPoolState(): PoolState {
  return { version: ACCOUNT_POOL_STATE_VERSION, leases: {}, cooldowns: {}, affinity: {}, workers: {}, lastPicked: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sanitizeLeases(raw: unknown): PoolState["leases"] {
  const leases: PoolState["leases"] = {}
  if (!isRecord(raw)) return leases
  for (const [provider, accounts] of Object.entries(raw)) {
    if (!isRecord(accounts)) continue
    const providerLeases: Record<string, Record<string, StoredLease>> = {}
    for (const [accountId, holders] of Object.entries(accounts)) {
      if (!isRecord(holders)) continue
      const holderLeases: Record<string, StoredLease> = {}
      for (const [workerId, entry] of Object.entries(holders)) {
        if (!isRecord(entry)) continue
        if (typeof entry.expiresAt !== "number" || typeof entry.updatedAt !== "number") continue
        holderLeases[workerId] = { expiresAt: entry.expiresAt, updatedAt: entry.updatedAt }
      }
      if (Object.keys(holderLeases).length > 0) providerLeases[accountId] = holderLeases
    }
    if (Object.keys(providerLeases).length > 0) leases[provider] = providerLeases
  }
  return leases
}

function sanitizeNumbers(raw: unknown): Record<string, number> {
  const values: Record<string, number> = {}
  if (!isRecord(raw)) return values
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) values[key] = value
  }
  return values
}

function sanitizeAffinity(raw: unknown): PoolState["affinity"] {
  const affinity: PoolState["affinity"] = {}
  if (!isRecord(raw)) return affinity
  for (const [workerId, providers] of Object.entries(raw)) {
    if (!isRecord(providers)) continue
    const entries: Record<ProviderId, { accountId: string; at: number }> = {}
    for (const [provider, entry] of Object.entries(providers)) {
      if (!isRecord(entry)) continue
      if (typeof entry.accountId !== "string" || typeof entry.at !== "number") continue
      entries[provider] = { accountId: entry.accountId, at: entry.at }
    }
    if (Object.keys(entries).length > 0) affinity[workerId] = entries
  }
  return affinity
}

function sanitizeLastPicked(raw: unknown): Record<ProviderId, string> {
  const picked: Record<ProviderId, string> = {}
  if (!isRecord(raw)) return picked
  for (const [provider, accountId] of Object.entries(raw)) {
    if (typeof accountId === "string") picked[provider] = accountId
  }
  return picked
}

export function sanitizePoolState(raw: unknown): PoolState {
  if (!isRecord(raw)) return emptyPoolState()
  return {
    version: ACCOUNT_POOL_STATE_VERSION,
    leases: sanitizeLeases(raw.leases),
    cooldowns: sanitizeNumbers(raw.cooldowns),
    affinity: sanitizeAffinity(raw.affinity),
    workers: sanitizeNumbers(raw.workers),
    lastPicked: sanitizeLastPicked(raw.lastPicked),
  }
}

export function activeHolders(state: PoolState, provider: ProviderId, accountId: string, now: number): string[] {
  const holders = state.leases[provider]?.[accountId]
  if (!holders) return []
  return Object.entries(holders)
    .filter(([, lease]) => lease.expiresAt > now)
    .map(([workerId]) => workerId)
}

export function isCooling(state: PoolState, accountId: string, now: number): boolean {
  const until = state.cooldowns[accountId]
  return typeof until === "number" && until > now
}

export function prunePoolState(state: PoolState, now: number): void {
  for (const [provider, accounts] of Object.entries(state.leases)) {
    for (const [accountId, holders] of Object.entries(accounts)) {
      for (const [workerId, lease] of Object.entries(holders)) {
        if (lease.expiresAt <= now) delete holders[workerId]
      }
      if (Object.keys(holders).length === 0) delete accounts[accountId]
    }
    if (Object.keys(accounts).length === 0) delete state.leases[provider]
  }

  for (const [accountId, until] of Object.entries(state.cooldowns)) {
    if (until <= now) delete state.cooldowns[accountId]
  }

  for (const [workerId, providers] of Object.entries(state.affinity)) {
    for (const [provider, entry] of Object.entries(providers)) {
      if (now - entry.at > ACCOUNT_POOL_AFFINITY_TTL_MS) delete providers[provider]
    }
    if (Object.keys(providers).length === 0) delete state.affinity[workerId]
  }

  for (const [workerId, lastSeen] of Object.entries(state.workers)) {
    if (now - lastSeen > ACCOUNT_POOL_AFFINITY_TTL_MS) delete state.workers[workerId]
  }
}

async function persist(path: string, state: PoolState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  await rename(tmp, path)
}

export class PoolStateStore {
  private state: PoolState | undefined
  private loading: Promise<void> | undefined
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly path = ACCOUNT_POOL_STATE_PATH) {}

  private async ensureLoaded(): Promise<PoolState> {
    if (this.state) return this.state
    this.loading ??= (async () => {
      const raw = await readFile(this.path, "utf8").catch(() => undefined)
      if (!raw) {
        this.state = emptyPoolState()
        return
      }
      try {
        this.state = sanitizePoolState(JSON.parse(raw))
      } catch {
        this.state = emptyPoolState()
      }
    })()
    await this.loading
    return this.state ?? emptyPoolState()
  }

  async read<T>(fn: (state: PoolState) => T): Promise<T> {
    const state = await this.ensureLoaded()
    return fn(state)
  }

  mutate<T>(fn: (state: PoolState) => T | Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const current = await this.ensureLoaded()
      const next = structuredClone(current)
      const result = await fn(next)
      await persist(this.path, next)
      this.state = next
      return result
    }
    const job = this.chain.then(run, run)
    this.chain = job.then(
      () => undefined,
      () => undefined,
    )
    return job
  }

  async flush(): Promise<void> {
    const job = this.chain.then(async () => {
      const state = await this.ensureLoaded()
      await persist(this.path, state)
    })
    this.chain = job.then(
      () => undefined,
      () => undefined,
    )
    await job
  }
}

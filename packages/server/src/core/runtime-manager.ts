// ---------------------------------------------------------------------------
// RuntimeManager — top-level orchestrator that owns the set of registered
// RuntimeProviders and routes repo lifecycle calls to the right one. Routes
// consume this manager to obtain a RuntimeClient without caring about which
// runtime backs it.
// ---------------------------------------------------------------------------

import { eq } from "drizzle-orm"

import type { RuntimeClient } from "./runtime-client"
import type { RuntimeProvider, RuntimeHealth } from "./runtime-provider"
import type { AccountPool, AcquireResult } from "./types"
import { getRegistry } from "./registry"

import { db } from "../db/index"
import { repos, settings } from "../db/schema"
import { logger } from "../middleware/logger"
import { sessionMonitor } from "../lib/session-monitor"
import { isWorkerMode, getWorkerConfig, reloadWorkerConfig } from "../lib/config"
import { localAccountPool } from "../lib/local-account-pool"
import { createLeaseClient, type LeaseClient, type LeaseFailure } from "../lib/lease-client"
import { createLeaseKeeper, type LeaseKeeper } from "../lib/lease-keeper"
import { writeLease } from "../lib/lease-writer"
import { parseResetMsFromMessage } from "../lib/account-switcher"

export interface RuntimeManager {
  registerProvider(provider: RuntimeProvider): void
  listProviders(): RuntimeProvider[]

  start(repoId: string, localPath: string, runtimeId?: string): Promise<RuntimeClient>
  stop(repoId: string): Promise<void>
  startAll(): Promise<void>
  stopAll(): Promise<void>
  killAllSync(): void

  getClient(repoId: string | undefined): RuntimeClient | null
  requireClient(repoId: string | undefined): RuntimeClient
  isRunning(repoId: string): boolean
  healthCheck(repoId: string): Promise<RuntimeHealth>

  getHeldAccountId(): string | undefined
  adoptHeldAccount(accountId: string): void
  reloadCloudPool(): Promise<void>
}

// ---------------------------------------------------------------------------
// Cloud lease pool — mirror of the previous process-manager implementation.
// Lives here because the RuntimeManager owns the pool switch during
// startAll/reloadCloudPool. The OpenCodeProvider only cares about spawning
// the runtime process.
// ---------------------------------------------------------------------------

const LEASE_FAILURE_MESSAGES: Record<LeaseFailure["kind"], string> = {
  "no-account": "云端账号池暂无可用账号",
  unreachable: "连不上云端账号池，无法切号",
  "bad-response": "云端账号池返回了无法识别的响应",
  refused: "云端账号池拒绝了本次租借请求",
}

function createLeaseAccountPool(leaseClient: LeaseClient, keeper: LeaseKeeper): AccountPool {
  return {
    async acquire(ctx): Promise<AcquireResult> {
      const outcome = await leaseClient.lease({
        reason: "ratelimit",
        ...(ctx.currentAccountId ? { currentAccountId: ctx.currentAccountId } : {}),
      })
      if (!outcome.ok) {
        return { ok: false, reason: LEASE_FAILURE_MESSAGES[outcome.failure.kind] }
      }
      const { lease } = outcome
      if (lease.expiresAt <= Date.now()) {
        return { ok: false, reason: "stale lease" }
      }
      await writeLease({ access: lease.access, expires: lease.expiresAt, accountId: lease.accountId })
      keeper.adoptAccount(lease.accountId)
      return {
        ok: true,
        accountId: lease.accountId,
        credential: { access: lease.access },
        expiresAt: lease.expiresAt,
      }
    },
    async reportLimit(ctx): Promise<void> {
      const resetsAt = parseResetMsFromMessage(ctx.message)
      await leaseClient.reportRateLimit({
        accountId: ctx.accountId,
        headers: {},
        ...(resetsAt !== undefined ? { resetsAt } : {}),
      })
    },
    async getActiveId(): Promise<string | undefined> {
      return keeper.heldAccountId()
    },
  }
}

// ---------------------------------------------------------------------------
// Default implementation
// ---------------------------------------------------------------------------

const DEFAULT_RUNTIME_ID = "opencode"

export function createDefaultRuntimeManager(): RuntimeManager {
  const providers = new Map<string, RuntimeProvider>()
  const repoProviders = new Map<string, string>()
  let defaultProviderId: string | undefined
  let activeLeaseKeeper: LeaseKeeper | undefined

  function resolveProviderId(runtimeId?: string): string {
    if (runtimeId) return runtimeId
    return defaultProviderId ?? DEFAULT_RUNTIME_ID
  }

  function providerFor(repoId: string | undefined): RuntimeProvider | undefined {
    if (!repoId) return undefined
    const providerId = repoProviders.get(repoId)
    if (!providerId) return undefined
    return providers.get(providerId)
  }

  const manager: RuntimeManager = {
    registerProvider(provider: RuntimeProvider): void {
      providers.set(provider.id, provider)
      if (!defaultProviderId) defaultProviderId = provider.id
    },

    listProviders(): RuntimeProvider[] {
      return Array.from(providers.values())
    },

    async start(repoId: string, localPath: string, runtimeId?: string): Promise<RuntimeClient> {
      const providerId = resolveProviderId(runtimeId)
      const provider = providers.get(providerId)
      if (!provider) throw new Error(`Runtime provider "${providerId}" not registered`)

      await provider.initialize(repoId, localPath)
      repoProviders.set(repoId, providerId)

      if (providerId !== "opencode") {
        try {
          const { readAuthAnthropic } = await import("../lib/auth-files")
          const auth = await readAuthAnthropic()
          if (auth?.access) {
            await provider.credentialWriter.write({
              kind: auth.refresh ? "full" : "lease",
              access: auth.access,
              ...(auth.refresh ? { refresh: auth.refresh } : {}),
              expires: auth.expires,
            } as Parameters<typeof provider.credentialWriter.write>[0])
            logger.info({ repoId, providerId }, "synced active credential to runtime")
          }
        } catch {}
      }

      const client = provider.getClient(repoId)
      if (!client) {
        throw new Error(`Runtime provider "${providerId}" did not produce a client for repo ${repoId}`)
      }

      sessionMonitor.register(repoId, client)
      return client
    },

    async stop(repoId: string): Promise<void> {
      const provider = providerFor(repoId)
      if (!provider) return
      sessionMonitor.unregister(repoId)
      await provider.teardown(repoId)
      repoProviders.delete(repoId)
    },

    getClient(repoId: string | undefined): RuntimeClient | null {
      const provider = providerFor(repoId)
      if (!provider || !repoId) return null
      return provider.getClient(repoId)
    },

    requireClient(repoId: string | undefined): RuntimeClient {
      if (!repoId) throw new Error("Missing repoId")
      const client = manager.getClient(repoId)
      if (!client) throw new Error(`Repo ${repoId} is not running`)
      return client
    },

    isRunning(repoId: string): boolean {
      const provider = providerFor(repoId)
      if (!provider) return false
      return provider.isReady(repoId)
    },

    async healthCheck(repoId: string): Promise<RuntimeHealth> {
      const provider = providerFor(repoId)
      if (!provider) return { reachable: false }
      return provider.healthCheck(repoId)
    },

    async startAll(): Promise<void> {
      if (isWorkerMode()) {
        const cfg = getWorkerConfig()!
        logger.info({ masterUrl: cfg.masterUrl, workerId: cfg.workerId }, "cloud worker mode: initializing")
        const client = createLeaseClient(cfg.masterUrl, cfg.workerId)
        const healthy = await client.healthCheck()
        if (healthy) logger.info("cloud worker: master health check passed")
        else logger.warn("cloud worker: master health check failed, lease-keeper will retry")

        const keeper = createLeaseKeeper(client)
        activeLeaseKeeper = keeper
        await keeper.startup().catch((err) => logger.warn({ err }, "cloud worker: startup lease failed"))

        getRegistry().accountPool = createLeaseAccountPool(client, keeper)
      }

      const allRepos = await db.select().from(repos)
      logger.info({ count: allRepos.length }, "starting runtime for all repos")
      for (const repo of allRepos) {
        try {
          await manager.start(repo.id, repo.localPath, repo.runtimeType ?? undefined)
        } catch (err) {
          logger.error({ err, repoId: repo.id, localPath: repo.localPath }, "failed to start runtime for repo")
          await db.update(repos).set({ status: "error", updatedAt: Date.now() }).where(eq(repos.id, repo.id))
        }
      }
      sessionMonitor.start()
    },

    async stopAll(): Promise<void> {
      sessionMonitor.stop()
      if (activeLeaseKeeper) {
        activeLeaseKeeper.dispose()
        activeLeaseKeeper = undefined
      }
      const ids = Array.from(repoProviders.keys())
      for (const id of ids) {
        await manager.stop(id)
      }
    },

    killAllSync(): void {
      for (const provider of providers.values()) {
        provider.killAllSync()
      }
      repoProviders.clear()
    },

    getHeldAccountId(): string | undefined {
      return activeLeaseKeeper?.heldAccountId()
    },

    adoptHeldAccount(accountId: string): void {
      activeLeaseKeeper?.adoptAccount(accountId)
    },

    async reloadCloudPool(): Promise<void> {
      if (activeLeaseKeeper) {
        activeLeaseKeeper.dispose()
        activeLeaseKeeper = undefined
        logger.info("cloud pool: disposed previous lease-keeper")
      }
      getRegistry().accountPool = localAccountPool

      const getSetting = async (key: string) => {
        const rows = await db.select().from(settings).where(eq(settings.key, key))
        return rows[0]?.value
      }
      await reloadWorkerConfig(getSetting)

      if (!isWorkerMode()) {
        logger.info("cloud pool: switched to local mode")
        return
      }

      const cfg = getWorkerConfig()!
      logger.info({ masterUrl: cfg.masterUrl, workerId: cfg.workerId }, "cloud pool: reconnecting")
      const client = createLeaseClient(cfg.masterUrl, cfg.workerId)
      const healthy = await client.healthCheck()
      if (healthy) logger.info("cloud pool: master health check passed")
      else logger.warn("cloud pool: master health check failed, lease-keeper will retry")

      const keeper = createLeaseKeeper(client)
      activeLeaseKeeper = keeper
      await keeper.startup().catch((err) => logger.warn({ err }, "cloud pool: startup lease failed"))

      getRegistry().accountPool = createLeaseAccountPool(client, keeper)
      logger.info("cloud pool: reload complete")
    },
  }

  return manager
}

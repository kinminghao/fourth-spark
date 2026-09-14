import { describe, expect, test, beforeEach } from "bun:test"
import {
  initWorkerConfig,
  reloadWorkerConfig,
  isWorkerMode,
  getWorkerConfig,
  getDefaultWorkerId,
} from "../../src/lib/config"

// Helper: create a mock getSetting function
function mockGetSetting(values: Record<string, string | undefined>) {
  return async (key: string) => values[key]
}

describe("initWorkerConfig", () => {
  beforeEach(async () => {
    // Reset cache by initializing with empty DB and no env
    delete process.env.MASTER_URL
    delete process.env.WORKER_ID
    await initWorkerConfig(mockGetSetting({}))
  })

  test("loads config from DB settings", async () => {
    await initWorkerConfig(mockGetSetting({
      cloud_master_url: "https://pool.example.com",
      cloud_worker_id: "worker-1",
    }))
    expect(isWorkerMode()).toBe(true)
    expect(getWorkerConfig()).toEqual({
      masterUrl: "https://pool.example.com",
      workerId: "worker-1",
    })
  })

  test("strips trailing slashes from masterUrl", async () => {
    await initWorkerConfig(mockGetSetting({
      cloud_master_url: "https://pool.example.com///",
      cloud_worker_id: "worker-1",
    }))
    expect(getWorkerConfig()?.masterUrl).toBe("https://pool.example.com")
  })

  test("falls back to env vars when DB has no config", async () => {
    process.env.MASTER_URL = "https://env-pool.example.com"
    process.env.WORKER_ID = "env-worker"
    await initWorkerConfig(mockGetSetting({}))
    expect(isWorkerMode()).toBe(true)
    expect(getWorkerConfig()).toEqual({
      masterUrl: "https://env-pool.example.com",
      workerId: "env-worker",
    })
    delete process.env.MASTER_URL
    delete process.env.WORKER_ID
  })

  test("returns null when neither DB nor env configured", async () => {
    await initWorkerConfig(mockGetSetting({}))
    expect(isWorkerMode()).toBe(false)
    expect(getWorkerConfig()).toBeNull()
  })

  test("rejects invalid masterUrl (not HTTP)", async () => {
    await initWorkerConfig(mockGetSetting({
      cloud_master_url: "ftp://invalid.com",
      cloud_worker_id: "worker-1",
    }))
    expect(isWorkerMode()).toBe(false)
  })

  test("rejects invalid workerId (too long)", async () => {
    await initWorkerConfig(mockGetSetting({
      cloud_master_url: "https://pool.example.com",
      cloud_worker_id: "a".repeat(65),
    }))
    expect(isWorkerMode()).toBe(false)
  })

  test("rejects workerId with invalid chars", async () => {
    await initWorkerConfig(mockGetSetting({
      cloud_master_url: "https://pool.example.com",
      cloud_worker_id: "worker with spaces",
    }))
    expect(isWorkerMode()).toBe(false)
  })
})

describe("reloadWorkerConfig", () => {
  test("updates config from DB", async () => {
    await initWorkerConfig(mockGetSetting({}))
    expect(isWorkerMode()).toBe(false)

    await reloadWorkerConfig(mockGetSetting({
      cloud_master_url: "https://new-pool.example.com",
      cloud_worker_id: "new-worker",
    }))
    expect(isWorkerMode()).toBe(true)
    expect(getWorkerConfig()?.masterUrl).toBe("https://new-pool.example.com")
  })
})

describe("getDefaultWorkerId", () => {
  test("returns a non-empty string", () => {
    const id = getDefaultWorkerId()
    expect(id.length).toBeGreaterThan(0)
    expect(id.length).toBeLessThanOrEqual(64)
  })

  test("contains only valid characters", () => {
    const id = getDefaultWorkerId()
    expect(id).toMatch(/^[A-Za-z0-9._-]+$/)
  })
})

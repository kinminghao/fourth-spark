import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { eq } from "drizzle-orm"
import { db } from "../../../src/db/index"
import { agentMemories, customAgents, sessions } from "../../../src/db/schema"
import {
  EXTRACTION_CLAIM_LEASE_MS,
  EXTRACTION_MAX_ATTEMPTS,
  EXTRACTION_RETRY_BACKOFF_MS,
  claimExtractionAttempt,
  listExtractableSessions,
  processExtractionOutput,
  settleExtractionFailure,
  settleExtractionSuccess,
} from "../../../src/lib/memory-extractor"
import { truncateAll } from "../../helpers/db"

beforeAll(() => {
  execSync("bunx drizzle-kit push --force", {
    cwd: new URL("../../../", import.meta.url).pathname,
    env: { ...process.env },
    stdio: "pipe",
  })
})

beforeEach(async () => {
  await truncateAll(db as any)
})

const DAY_MS = 86_400_000

async function seedAgent(id: string, memoryEnabled = 1) {
  const now = Date.now()
  await db.insert(customAgents).values({
    id,
    name: `Agent ${id}`,
    baseAgent: "build",
    memoryEnabled,
    createdAt: now,
    updatedAt: now,
  })
}

async function seedSession(id: string, customAgentId: string, timeUpdated: number, title = `Session ${id}`) {
  const now = Date.now()
  await db.insert(sessions).values({
    id,
    customAgentId,
    title,
    timeCreated: now,
    timeUpdated,
  })
}

async function seedMemory(id: string, customAgentId: string, sessionId: string, createdAt: number) {
  await db.insert(agentMemories).values({
    id,
    customAgentId,
    sessionId,
    content: "A remembered fact",
    category: "general",
    importance: 0.5,
    createdAt,
    updatedAt: createdAt,
  })
}

async function readCursor(sessionId: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  return row
}

describe("claimExtractionAttempt (scheduled)", () => {
  test("fresh session claims with attempts 1 and a lease", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)

    const claim = await claimExtractionAttempt("ses-1")
    expect(claim).toMatchObject({ attempts: 1, claimedVersion: t })
    expect(claim?.leaseUntil ?? 0).toBeGreaterThan(Date.now())

    const row = await readCursor("ses-1")
    expect(row?.lastExtractionAt).toBe(t)
    expect(row?.extractionAttempts).toBe(1)
    expect(row?.extractionRetryAt).toBe(claim?.leaseUntil)
    expect(row?.extractionRetryAt ?? 0).toBeLessThanOrEqual(Date.now() + EXTRACTION_CLAIM_LEASE_MS)
  })

  test("in-flight lease blocks a duplicate claim", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)

    await claimExtractionAttempt("ses-1")
    const second = await claimExtractionAttempt("ses-1")
    expect(second).toBeNull()

    const row = await readCursor("ses-1")
    expect(row?.extractionAttempts).toBe(1)
  })

  test("retry after backoff increments attempts", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)
    await db
      .update(sessions)
      .set({ extractionRetryAt: Date.now() - 1_000, extractionAttempts: 1, lastExtractionAt: t })
      .where(eq(sessions.id, "ses-1"))

    const claim = await claimExtractionAttempt("ses-1")
    expect(claim?.attempts).toBe(2)
    expect(claim?.claimedVersion).toBe(t)
  })

  test("exhausted attempts stay dormant until content changes", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)
    await db
      .update(sessions)
      .set({
        extractionAttempts: EXTRACTION_MAX_ATTEMPTS,
        extractionRetryAt: Date.now() - 1_000,
        lastExtractionAt: t,
      })
      .where(eq(sessions.id, "ses-1"))

    expect(await claimExtractionAttempt("ses-1")).toBeNull()

    await db
      .update(sessions)
      .set({ timeUpdated: t + 100 })
      .where(eq(sessions.id, "ses-1"))
    const claim = await claimExtractionAttempt("ses-1")
    expect(claim?.attempts).toBe(1)
    expect(claim?.claimedVersion).toBe(t + 100)
  })

  test("legacy bootstrap claims when memory predates the session update", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)
    await seedMemory("mem-1", "agent-1", "ses-1", t - 5_000)

    const claim = await claimExtractionAttempt("ses-1")
    expect(claim?.attempts).toBe(1)
    expect(claim?.claimedVersion).toBe(t)
  })

  test("legacy bootstrap stays dormant when memory is newer than the session", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)
    await seedMemory("mem-1", "agent-1", "ses-1", t + 5_000)

    expect(await claimExtractionAttempt("ses-1")).toBeNull()
  })

  test("bounded retry chain gives up after max attempts", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)

    const first = await claimExtractionAttempt("ses-1")
    expect(first?.attempts).toBe(1)
    const settledFirst = await settleExtractionFailure("ses-1", 1, first?.leaseUntil ?? 0)
    expect(settledFirst).toBe(true)
    let row = await readCursor("ses-1")
    expect(row?.extractionRetryAt ?? 0).toBeGreaterThan(Date.now() + EXTRACTION_RETRY_BACKOFF_MS[0] - 10_000)
    expect(row?.extractionRetryAt ?? 0).toBeLessThan(Date.now() + EXTRACTION_RETRY_BACKOFF_MS[0] + 10_000)

    await db
      .update(sessions)
      .set({ extractionRetryAt: Date.now() - 1 })
      .where(eq(sessions.id, "ses-1"))
    const second = await claimExtractionAttempt("ses-1")
    expect(second?.attempts).toBe(2)
    expect(await settleExtractionFailure("ses-1", 2, second?.leaseUntil ?? 0)).toBe(true)
    row = await readCursor("ses-1")
    expect(row?.extractionRetryAt ?? 0).toBeGreaterThan(Date.now() + EXTRACTION_RETRY_BACKOFF_MS[1] - 10_000)
    expect(row?.extractionRetryAt ?? 0).toBeLessThan(Date.now() + EXTRACTION_RETRY_BACKOFF_MS[1] + 10_000)

    await db
      .update(sessions)
      .set({ extractionRetryAt: Date.now() - 1 })
      .where(eq(sessions.id, "ses-1"))
    const third = await claimExtractionAttempt("ses-1")
    expect(third?.attempts).toBe(3)
    expect(await settleExtractionFailure("ses-1", 3, third?.leaseUntil ?? 0)).toBe(true)
    row = await readCursor("ses-1")
    expect(row?.extractionRetryAt).toBeNull()

    expect(await claimExtractionAttempt("ses-1")).toBeNull()
  })

  test("success clears attempts and retry and blocks the same version", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)

    const claim = await claimExtractionAttempt("ses-1")
    expect(await settleExtractionSuccess("ses-1", claim?.leaseUntil ?? 0)).toBe(true)

    const row = await readCursor("ses-1")
    expect(row?.extractionAttempts).toBe(0)
    expect(row?.extractionRetryAt).toBeNull()
    expect(row?.lastExtractionAt).toBe(t)

    expect(await claimExtractionAttempt("ses-1")).toBeNull()
  })

  test("superseded settle cannot clobber a newer claim", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)

    const first = await claimExtractionAttempt("ses-1")
    await db
      .update(sessions)
      .set({ extractionRetryAt: Date.now() - 1 })
      .where(eq(sessions.id, "ses-1"))
    const second = await claimExtractionAttempt("ses-1")
    expect(second?.attempts).toBe(2)

    const stale = await settleExtractionSuccess("ses-1", first?.leaseUntil ?? 0)
    expect(stale).toBe(false)

    let row = await readCursor("ses-1")
    expect(row?.extractionAttempts).toBe(2)
    expect(row?.extractionRetryAt).toBe(second?.leaseUntil)

    expect(await settleExtractionSuccess("ses-1", second?.leaseUntil ?? 0)).toBe(true)
    row = await readCursor("ses-1")
    expect(row?.extractionAttempts).toBe(0)
    expect(row?.extractionRetryAt).toBeNull()
  })

  test("superseded failure settle is rejected", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)

    const first = await claimExtractionAttempt("ses-1")
    await db
      .update(sessions)
      .set({ extractionRetryAt: Date.now() - 1 })
      .where(eq(sessions.id, "ses-1"))
    const second = await claimExtractionAttempt("ses-1")
    expect(second?.attempts).toBe(2)

    const applied = await settleExtractionFailure("ses-1", 1, first?.leaseUntil ?? 0)
    expect(applied).toBe(false)

    const row = await readCursor("ses-1")
    expect(row?.extractionAttempts).toBe(2)
    expect(row?.extractionRetryAt).toBe(second?.leaseUntil)
  })

  test("explicit empty output completes and settles once", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)

    const claim = await claimExtractionAttempt("ses-1")
    const outcome = await processExtractionOutput("agent-1", "ses-1", "[]")
    expect(outcome.kind).toBe("completed")
    if (outcome.kind === "completed") {
      expect(outcome.actionCount).toBe(0)
      expect(outcome.applied).toBe(0)
    }

    expect(await settleExtractionSuccess("ses-1", claim?.leaseUntil ?? 0)).toBe(true)
    expect(await claimExtractionAttempt("ses-1")).toBeNull()
  })

  test("valid actions are applied and settled", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)

    const claim = await claimExtractionAttempt("ses-1")
    const payload = JSON.stringify([
      { action: "add", content: "Prefers concise answers", category: "general", importance: 0.5 },
    ])
    const outcome = await processExtractionOutput("agent-1", "ses-1", payload)
    expect(outcome.kind).toBe("completed")
    if (outcome.kind === "completed") {
      expect(outcome.actionCount).toBe(1)
      expect(outcome.applied).toBe(1)
    }

    const memories = await db.select().from(agentMemories).where(eq(agentMemories.sessionId, "ses-1"))
    expect(memories).toHaveLength(1)
    expect(memories[0]?.content).toBe("Prefers concise answers")

    expect(await settleExtractionSuccess("ses-1", claim?.leaseUntil ?? 0)).toBe(true)
    expect(await claimExtractionAttempt("ses-1")).toBeNull()
  })

  test("concurrent claims yield exactly one winner", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)

    const [a, b] = await Promise.all([claimExtractionAttempt("ses-1"), claimExtractionAttempt("ses-1")])
    const winners = [a, b].filter((claim) => claim !== null)
    expect(winners).toHaveLength(1)
    expect(winners[0]?.attempts).toBe(1)
  })
})

describe("claimExtractionAttempt (manual)", () => {
  test("manual claim bypasses far-future backoff and resets attempts", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)
    await db
      .update(sessions)
      .set({ extractionRetryAt: Date.now() + 4 * 3_600_000, extractionAttempts: 2, lastExtractionAt: t - 9_999 })
      .where(eq(sessions.id, "ses-1"))

    const claim = await claimExtractionAttempt("ses-1", "manual")
    expect(claim?.attempts).toBe(1)
    expect(claim?.claimedVersion).toBe(t)

    const row = await readCursor("ses-1")
    expect(row?.extractionAttempts).toBe(1)
    expect(row?.lastExtractionAt).toBe(t)
    expect(row?.extractionRetryAt ?? 0).toBeGreaterThan(Date.now())
  })

  test("manual claim is rejected while a run is likely in-flight", async () => {
    const t = Date.now()
    await seedAgent("agent-1")
    await seedSession("ses-1", "agent-1", t)
    await db
      .update(sessions)
      .set({ extractionRetryAt: Date.now() + 5 * 60_000, extractionAttempts: 1, lastExtractionAt: t })
      .where(eq(sessions.id, "ses-1"))

    expect(await claimExtractionAttempt("ses-1", "manual")).toBeNull()
  })
})

describe("listExtractableSessions", () => {
  test("filters, classifies stale backlog, and orders due sessions", async () => {
    const t = Date.now()
    await seedAgent("agent-on", 1)
    await seedAgent("agent-off", 0)

    await seedSession("S1", "agent-on", t)
    await seedSession("S2", "agent-on", t - 8 * DAY_MS)
    await seedSession("S3", "agent-on", t - 1_000)
    await seedMemory("m3", "agent-on", "S3", t - 500)
    await seedSession("S4", "agent-on", t - 2_000)
    await seedMemory("m4", "agent-on", "S4", t - 5_000)
    await seedSession("S5", "agent-on", t - 3_000)
    await db
      .update(sessions)
      .set({ lastExtractionAt: t - 3_000, extractionRetryAt: t + 4 * 3_600_000 })
      .where(eq(sessions.id, "S5"))
    await seedSession("S6", "agent-off", t)
    await seedSession("S7", "agent-on", t, "[internal] memory extraction")

    const result = await listExtractableSessions()
    const dueIds = result.due.map((entry) => entry.id)

    expect(dueIds).toEqual(["S1", "S4"])
    expect(result.skippedStale).toBe(1)
    expect(dueIds).not.toContain("S3")
    expect(dueIds).not.toContain("S5")
    expect(dueIds).not.toContain("S6")
    expect(dueIds).not.toContain("S7")
  })
})

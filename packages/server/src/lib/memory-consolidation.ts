import { eq, and, isNull, isNotNull, lt, gte, desc, sql } from "drizzle-orm"
import { db } from "../db/index"
import { agentMemories, customAgents, sessions as sessionsTable } from "../db/schema"
import { FORBIDDEN_CONTENT_PATTERNS, type ExtractionAction, parseExtractionResult, executeActions } from "./memory-extractor"
import { MEMORY_CONSOLIDATOR_ID, MEMORY_CONSOLIDATOR_PROMPT } from "./system-agents"
import { resolveAgent } from "./agent-validator"
import { DEFAULT_VARIANT } from "./config"
import { logger } from "../middleware/logger"
import { unlink, mkdir, appendFile, readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import type { RuntimeClient } from "../core/runtime-client"

// ---------------------------------------------------------------------------
// Public change/stats types
// ---------------------------------------------------------------------------

export interface MemoryChange {
  action: "update" | "merge" | "delete" | "reinforce" | "decay" | "add"
  ts: number
  oldContent?: string
  oldImportance?: number
  newImportance?: number
  sourceContents?: string[]
  sourceIds?: string[]
  reason?: string
}

export interface ConsolidationStats {
  totalActive: number
  flagged: number
  stale: number
  skippedFlagged: number
  lastConsolidatedAt: number | null
  lastActions: { update: number; merge: number; delete: number; skip: number; decayed: number } | null
  recentChanges: Record<string, MemoryChange>
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const CONSOLIDATION_MIN_MEMORIES = 15
const CONSOLIDATION_MAX_ACTIONS = 15
const CONSOLIDATION_MAX_DELETES = 5
const CONSOLIDATION_BATCH_SIZE = 40
const CONSOLIDATION_TIMEOUT_MS = 120_000
const DECAY_STALE_DAYS = 7
const DECAY_FACTOR = 0.962
const DECAY_FLOOR = 0.2
const DRY_RUN = process.env.CONSOLIDATION_DRY_RUN === "true"

const MAX_CONTENT_CHARS_BEFORE_FLAG = 120
const FLAGGED_RATIO_THRESHOLD = 0.2
const POLL_INTERVAL_MS = 2_000
const PROJECT_NAME_PATTERN = /\b(fourth-spark|fourth_spark)\b/i
const MEMORY_LOG_ROOT = join("data", "memory-logs")
const CONSOLIDATION_SESSION_TITLE = "[internal] memory consolidation"

// ---------------------------------------------------------------------------
// Module-level scheduling state
// ---------------------------------------------------------------------------

const lastConsolidated = new Map<string, number>()
const consolidatingAgents = new Set<string>()
const lastRunSummaries = new Map<string, { update: number; merge: number; delete: number; skip: number; decayed: number }>()
const lastRecentChanges = new Map<string, Record<string, MemoryChange>>()
const lastSkippedFlagged = new Map<string, number>()

// ---------------------------------------------------------------------------
// Flags & action validation
// ---------------------------------------------------------------------------

function computeFlags(content: string): string[] {
  const flags: string[] = []
  if (content.length > MAX_CONTENT_CHARS_BEFORE_FLAG) flags.push("too_long")
  for (const { pattern, reason } of FORBIDDEN_CONTENT_PATTERNS) {
    if (pattern.test(content)) flags.push(reason.replace(/\s+/g, "_"))
  }
  if (PROJECT_NAME_PATTERN.test(content)) flags.push("contains_project_name")
  return flags
}

function extractReferencedIds(action: ExtractionAction): string[] {
  switch (action.action) {
    case "add": return []
    case "merge": return action.targetIds
    case "update":
    case "reinforce":
    case "skip":
    case "delete":
      return [action.targetId]
  }
}

function validateConsolidationActions(actions: ExtractionAction[], activeIds: Set<string>): ExtractionAction[] {
  const filtered: ExtractionAction[] = []
  let nonSkipCount = 0
  let deleteCount = 0

  for (const action of actions) {
    if (action.action === "add") {
      logger.warn({ action: "add" }, "consolidation dropped 'add' action (consolidation never adds)")
      continue
    }

    const refIds = extractReferencedIds(action)
    const invalidId = refIds.find((id) => !activeIds.has(id))
    if (invalidId) {
      logger.warn({ action: action.action, invalidId }, "consolidation dropped action referencing unknown memory id")
      continue
    }

    if (action.action !== "skip") {
      if (nonSkipCount >= CONSOLIDATION_MAX_ACTIONS) {
        logger.warn({ cap: CONSOLIDATION_MAX_ACTIONS }, "consolidation action cap reached, dropping remainder")
        continue
      }
      if (action.action === "delete") {
        if (deleteCount >= CONSOLIDATION_MAX_DELETES) {
          logger.warn({ cap: CONSOLIDATION_MAX_DELETES }, "consolidation delete cap reached, dropping delete")
          continue
        }
        deleteCount++
      }
      nonSkipCount++
    }

    filtered.push(action)
  }

  return filtered
}

// ---------------------------------------------------------------------------
// Persistent JSONL memory log (per agent, per day)
// ---------------------------------------------------------------------------

async function writeMemoryLog(agentId: string, entry: Record<string, unknown>): Promise<void> {
  try {
    const dir = join(MEMORY_LOG_ROOT, agentId)
    await mkdir(dir, { recursive: true })
    const filename = `consolidation-${new Date().toISOString().slice(0, 10)}.jsonl`
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n"
    await appendFile(join(dir, filename), line)
  } catch (err) {
    logger.warn({ err, agentId }, "failed to write memory consolidation log")
  }
}

// ---------------------------------------------------------------------------
// Importance decay for stale memories
// ---------------------------------------------------------------------------

async function applyImportanceDecay(customAgentId: string): Promise<{
  decayed: number
  unchanged: number
  changes: Record<string, MemoryChange>
}> {
  const cutoff = Date.now() - DECAY_STALE_DAYS * 86_400_000

  const staleRows = await db.select({
    id: agentMemories.id,
    importance: agentMemories.importance,
  })
    .from(agentMemories)
    .where(and(
      eq(agentMemories.customAgentId, customAgentId),
      isNull(agentMemories.supersededBy),
      lt(agentMemories.updatedAt, cutoff),
    ))
  const decayed = staleRows.length

  const totalRow = await db.select({ n: sql<number>`count(*)::int` })
    .from(agentMemories)
    .where(and(
      eq(agentMemories.customAgentId, customAgentId),
      isNull(agentMemories.supersededBy),
    ))
  const totalActive = totalRow[0]?.n ?? 0
  const unchanged = Math.max(0, totalActive - decayed)

  const changes: Record<string, MemoryChange> = {}
  const decayTs = Date.now()
  for (const row of staleRows) {
    const newImp = Math.max(DECAY_FLOOR, row.importance * DECAY_FACTOR)
    changes[row.id] = {
      action: "decay",
      ts: decayTs,
      oldImportance: row.importance,
      newImportance: newImp,
    }
  }

  if (decayed > 0 && !DRY_RUN) {
    // NOTE: intentionally do NOT update `updatedAt` — we must preserve the
    // staleness signal so future decay passes can identify which rows are
    // still stale (otherwise every decay would refresh timestamps and no
    // memory would ever decay a second time).
    await db.update(agentMemories)
      .set({ importance: sql`GREATEST(${DECAY_FLOOR}, importance * ${DECAY_FACTOR})` })
      .where(and(
        eq(agentMemories.customAgentId, customAgentId),
        isNull(agentMemories.supersededBy),
        lt(agentMemories.updatedAt, cutoff),
      ))
  }

  logger.info(
    { customAgentId, decayed, unchanged, cutoffDays: DECAY_STALE_DAYS, factor: DECAY_FACTOR, dryRun: DRY_RUN },
    "importance decay applied",
  )
  await writeMemoryLog(customAgentId, {
    type: "decay",
    decayed,
    unchanged,
    cutoffDays: DECAY_STALE_DAYS,
    factor: DECAY_FACTOR,
    dryRun: DRY_RUN,
  })

  return { decayed, unchanged, changes }
}

// ---------------------------------------------------------------------------
// Per-agent consolidation
// ---------------------------------------------------------------------------

type MemoryWithFlags = {
  id: string
  category: string
  importance: number
  content: string
  flags: string[]
}

function countByAction(actions: ExtractionAction[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const a of actions) counts[a.action] = (counts[a.action] ?? 0) + 1
  return counts
}

function buildActionLogEntry(
  action: ExtractionAction,
  contentById: Map<string, string>,
  dryRun: boolean,
): Record<string, unknown> {
  switch (action.action) {
    case "update":
      return {
        type: "action",
        action: "update",
        targetId: action.targetId,
        oldContent: contentById.get(action.targetId),
        newContent: action.content,
        importance: action.importance,
        dryRun,
      }
    case "merge":
      return {
        type: "action",
        action: "merge",
        sourceIds: action.targetIds,
        sourceContents: action.targetIds.map((id) => contentById.get(id)),
        newContent: action.content,
        category: action.category,
        importance: action.importance,
        dryRun,
      }
    case "delete":
      return {
        type: "action",
        action: "delete",
        targetId: action.targetId,
        oldContent: contentById.get(action.targetId),
        reason: action.reason,
        dryRun,
      }
    case "reinforce":
      return {
        type: "action",
        action: "reinforce",
        targetId: action.targetId,
        reason: action.reason,
        dryRun,
      }
    case "skip":
      return {
        type: "action",
        action: "skip",
        targetId: action.targetId,
        reason: action.reason,
        dryRun,
      }
    case "add":
      // Filtered out earlier by validateConsolidationActions; kept for exhaustiveness.
      return {
        type: "action",
        action: "add",
        content: action.content,
        category: action.category,
        importance: action.importance,
        dryRun,
      }
  }
}

async function processConsolidationBatch(
  customAgentId: string,
  client: RuntimeClient,
  batch: MemoryWithFlags[],
  batchIdx: number,
  totalBatches: number,
): Promise<{ actions: ExtractionAction[]; changes: Record<string, MemoryChange>; skippedFlagged: number }> {
  let consolidationSessionId: string | undefined
  const outputPath = `/tmp/memory-consolidate-${crypto.randomUUID()}.json`
  const batchStartTs = Date.now()

  try {
    await Bun.write(outputPath, "[]")

    const agent = await resolveAgent(client, "Sisyphus - ultraworker")
    const session = await client.createSession({ agent, title: CONSOLIDATION_SESSION_TITLE })
    consolidationSessionId = session.id

    await db.insert(sessionsTable).values({
      id: session.id,
      title: CONSOLIDATION_SESSION_TITLE,
      customAgentId: MEMORY_CONSOLIDATOR_ID,
      agent: agent ?? null,
      timeCreated: Date.now(),
      timeUpdated: Date.now(),
    }).onConflictDoUpdate({
      target: sessionsTable.id,
      set: { customAgentId: MEMORY_CONSOLIDATOR_ID, timeUpdated: Date.now() },
    })

    const payload = batch.map((m) => ({
      id: m.id,
      category: m.category,
      importance: m.importance,
      content: m.content,
      flags: m.flags,
    }))

    const fullPrompt =
      `${MEMORY_CONSOLIDATOR_PROMPT}\n\n输出文件路径：${outputPath}\n请用 Write 工具将 JSON 结果写入上述文件，完全替换原内容。\n\n---\n\n## 当前活跃记忆\n\n${JSON.stringify(payload, null, 2)}`

    await client.prompt(session.id, fullPrompt, { agent, variant: DEFAULT_VARIANT })
    logger.info(
      { sessionId: session.id, customAgentId, batchIdx, totalBatches, batchSize: batch.length, outputPath },
      "memory consolidation batch started, waiting for result",
    )

    const startedAt = Date.now()
    while (Date.now() - startedAt < CONSOLIDATION_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      try {
        const statuses = await client.getSessionStatus()
        const s = statuses[session.id]
        if (s && (s.type === "busy" || s.type === "retry")) continue
      } catch { continue }
      break
    }

    const file = Bun.file(outputPath)
    const resultText = (await file.exists()) ? (await file.text()).trim() : ""
    logger.info(
      { sessionId: session.id, customAgentId, batchIdx, resultLen: resultText.length },
      "memory consolidation batch file read",
    )

    if (!resultText || resultText === "[]") {
      logger.info({ customAgentId, batchIdx, totalBatches }, "consolidation batch returned empty result")
      await writeMemoryLog(customAgentId, {
        type: "consolidation_batch_empty",
        batchIdx,
        totalBatches,
        batchSize: batch.length,
      })
      return { actions: [], changes: {}, skippedFlagged: 0 }
    }

    const rawActions = parseExtractionResult(resultText)
    const activeIds = new Set(batch.map((m) => m.id))
    const actions = validateConsolidationActions(rawActions, activeIds)

    const flaggedIds = new Set(batch.filter((m) => m.flags.length > 0).map((m) => m.id))
    let skippedFlagged = 0
    for (const action of actions) {
      if (action.action === "skip" && flaggedIds.has(action.targetId)) {
        skippedFlagged++
        logger.warn(
          { customAgentId, batchIdx, memId: action.targetId },
          "consolidation: LLM chose 'skip' for a flagged memory (allowed for now)",
        )
      }
    }

    const contentById = new Map<string, string>()
    const importanceById = new Map<string, number>()
    for (const m of batch) {
      contentById.set(m.id, m.content)
      importanceById.set(m.id, m.importance)
    }

    if (DRY_RUN) {
      logger.info(
        { customAgentId, batchIdx, actionCount: actions.length, byAction: countByAction(actions) },
        "DRY_RUN: consolidation actions logged but not executed",
      )
    } else {
      await executeActions(customAgentId, "consolidation", actions)
    }

    for (const action of actions) {
      await writeMemoryLog(customAgentId, buildActionLogEntry(action, contentById, DRY_RUN))
    }

    await writeMemoryLog(customAgentId, {
      type: "consolidation_batch_summary",
      batchIdx,
      totalBatches,
      batchSize: batch.length,
      actionCount: actions.length,
      byAction: countByAction(actions),
      dryRun: DRY_RUN,
    })

    const changes: Record<string, MemoryChange> = {}
    if (!DRY_RUN) {
      const actionTs = Date.now()
      for (const action of actions) {
        switch (action.action) {
          case "update":
            changes[action.targetId] = {
              action: "update",
              ts: actionTs,
              oldContent: contentById.get(action.targetId),
              oldImportance: importanceById.get(action.targetId),
              newImportance: action.importance,
            }
            break
          case "merge":
            for (const srcId of action.targetIds) {
              changes[srcId] = {
                action: "merge",
                ts: actionTs,
                sourceContents: action.targetIds.map((id) => contentById.get(id) ?? ""),
                sourceIds: action.targetIds,
                oldContent: contentById.get(srcId),
                newImportance: action.importance,
              }
            }
            break
          case "delete":
            changes[action.targetId] = {
              action: "delete",
              ts: actionTs,
              oldContent: contentById.get(action.targetId),
              reason: action.reason,
            }
            break
          case "reinforce":
            changes[action.targetId] = {
              action: "reinforce",
              ts: actionTs,
              oldImportance: importanceById.get(action.targetId),
              reason: action.reason,
            }
            break
        }
      }

      const mergeActions = actions.filter(
        (a): a is Extract<ExtractionAction, { action: "merge" }> => a.action === "merge",
      )
      if (mergeActions.length > 0) {
        const newlyMerged = await db.select({
          id: agentMemories.id,
          mergedFrom: agentMemories.mergedFrom,
          importance: agentMemories.importance,
        })
          .from(agentMemories)
          .where(and(
            eq(agentMemories.customAgentId, customAgentId),
            isNotNull(agentMemories.mergedFrom),
            gte(agentMemories.createdAt, batchStartTs),
          ))
        for (const nm of newlyMerged) {
          const srcIds = nm.mergedFrom ?? []
          if (srcIds.length === 0) continue
          changes[nm.id] = {
            action: "merge",
            ts: actionTs,
            sourceContents: srcIds.map((id) => contentById.get(id) ?? ""),
            sourceIds: srcIds,
            newImportance: nm.importance,
          }
        }
      }
    }

    logger.info(
      { customAgentId, batchIdx, actionCount: actions.length, byAction: countByAction(actions), dryRun: DRY_RUN },
      "memory consolidation batch completed",
    )
    return { actions, changes, skippedFlagged }
  } catch (err) {
    logger.warn({ err, customAgentId, batchIdx }, "memory consolidation batch failed")
    return { actions: [], changes: {}, skippedFlagged: 0 }
  } finally {
    if (consolidationSessionId) {
      client.deleteSession(consolidationSessionId).catch(() => { /* best-effort cleanup */ })
    }
    try { await unlink(outputPath) } catch { /* cleanup */ }
  }
}

async function consolidateAgent(customAgentId: string, client: RuntimeClient): Promise<void> {
  const memories = await db.select().from(agentMemories)
    .where(and(
      eq(agentMemories.customAgentId, customAgentId),
      isNull(agentMemories.supersededBy),
    ))
    .orderBy(desc(agentMemories.importance))

  if (memories.length < CONSOLIDATION_MIN_MEMORIES) {
    logger.info(
      { customAgentId, count: memories.length, min: CONSOLIDATION_MIN_MEMORIES },
      "consolidation skipped: not enough active memories",
    )
    return
  }

  const withFlags: MemoryWithFlags[] = memories.map((m) => ({
    id: m.id,
    category: m.category,
    importance: m.importance,
    content: m.content,
    flags: computeFlags(m.content),
  }))

  const total = withFlags.length
  const flagged = withFlags.filter((m) => m.flags.length > 0).length
  const flaggedRatio = total > 0 ? flagged / total : 0

  if (flaggedRatio <= FLAGGED_RATIO_THRESHOLD) {
    logger.info(
      { customAgentId, total, flagged, flaggedRatio, threshold: FLAGGED_RATIO_THRESHOLD },
      "consolidation skipped: memories are mostly clean",
    )
    return
  }

  const batches: MemoryWithFlags[][] = []
  for (let i = 0; i < withFlags.length; i += CONSOLIDATION_BATCH_SIZE) {
    batches.push(withFlags.slice(i, i + CONSOLIDATION_BATCH_SIZE))
  }

  logger.info(
    { customAgentId, total, flagged, flaggedRatio, batchCount: batches.length, dryRun: DRY_RUN },
    "starting memory consolidation",
  )

  const accumulated = { update: 0, merge: 0, delete: 0, skip: 0 }
  const allChanges: Record<string, MemoryChange> = {}
  let allSkippedFlagged = 0
  for (let i = 0; i < batches.length; i++) {
    const result = await processConsolidationBatch(customAgentId, client, batches[i], i + 1, batches.length)
    for (const a of result.actions) {
      const key = a.action as keyof typeof accumulated
      if (key in accumulated) accumulated[key]++
    }
    Object.assign(allChanges, result.changes)
    allSkippedFlagged += result.skippedFlagged
  }
  lastRunSummaries.set(customAgentId, { ...accumulated, decayed: 0 })
  lastRecentChanges.set(customAgentId, allChanges)
  lastSkippedFlagged.set(customAgentId, allSkippedFlagged)
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function runMemoryConsolidation(
  entries: Array<{ repoId: string; client: RuntimeClient }>,
): Promise<void> {
  if (entries.length === 0) {
    logger.debug("runMemoryConsolidation: no runtime clients registered, skipping")
    return
  }

  let agents: Array<{ id: string }>
  try {
    agents = await db.select({ id: customAgents.id })
      .from(customAgents)
      .where(eq(customAgents.memoryEnabled, 1))
  } catch (err) {
    logger.error({ err }, "runMemoryConsolidation: failed to list memory-enabled agents")
    return
  }

  const client = entries[0].client

  for (const { id: agentId } of agents) {
    if (!consolidatingAgents.has(agentId)) {
      consolidatingAgents.add(agentId)
      try {
        await consolidateAgent(agentId, client)
        lastConsolidated.set(agentId, Date.now())
      } catch (err) {
        logger.error({ err, agentId }, "memory consolidation failed for agent")
      } finally {
        consolidatingAgents.delete(agentId)
      }
    }

    try {
      const decayResult = await applyImportanceDecay(agentId)
      const prev = lastRunSummaries.get(agentId)
      if (prev) {
        prev.decayed = decayResult.decayed
      } else {
        lastRunSummaries.set(agentId, { update: 0, merge: 0, delete: 0, skip: 0, decayed: decayResult.decayed })
      }
      const prevChanges = lastRecentChanges.get(agentId) ?? {}
      Object.assign(prevChanges, decayResult.changes)
      lastRecentChanges.set(agentId, prevChanges)
    } catch (err) {
      logger.error({ err, agentId }, "importance decay failed for agent")
    }
  }
}

// ---------------------------------------------------------------------------
// Stats query (for API / frontend)
// ---------------------------------------------------------------------------

async function readLastRunFromLog(agentId: string): Promise<{
  lastConsolidatedAt: number | null
  lastActions: { update: number; merge: number; delete: number; skip: number; decayed: number } | null
}> {
  try {
    const dir = join(MEMORY_LOG_ROOT, agentId)
    const files = await readdir(dir).catch(() => [] as string[])
    const logFiles = files.filter(f => f.startsWith("consolidation-") && f.endsWith(".jsonl")).sort().reverse()
    if (logFiles.length === 0) return { lastConsolidatedAt: null, lastActions: null }

    const content = await readFile(join(dir, logFiles[0]), "utf-8")
    const lines = content.trim().split("\n").filter(Boolean)

    let lastSummary: Record<string, unknown> | null = null
    let lastDecay: Record<string, unknown> | null = null
    let lastTs: number | null = null

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]) as Record<string, unknown>
        if (!lastTs && typeof entry.ts === "string") {
          lastTs = new Date(entry.ts).getTime()
        }
        if (!lastSummary && entry.type === "consolidation_batch_summary") {
          lastSummary = entry
        }
        if (!lastDecay && entry.type === "decay") {
          lastDecay = entry
        }
        if (lastSummary && lastDecay && lastTs) break
      } catch { continue }
    }

    if (!lastSummary && !lastDecay) return { lastConsolidatedAt: lastTs, lastActions: null }

    const byAction = (lastSummary?.byAction as Record<string, number>) ?? {}
    const decayed = (lastDecay?.decayed as number) ?? 0

    return {
      lastConsolidatedAt: lastTs,
      lastActions: {
        update: byAction.update ?? 0,
        merge: byAction.merge ?? 0,
        delete: byAction.delete ?? 0,
        skip: byAction.skip ?? 0,
        decayed,
      },
    }
  } catch {
    return { lastConsolidatedAt: null, lastActions: null }
  }
}

export async function getConsolidationStats(agentId: string): Promise<ConsolidationStats> {
  const memories = await db.select({ content: agentMemories.content, updatedAt: agentMemories.updatedAt })
    .from(agentMemories)
    .where(and(
      eq(agentMemories.customAgentId, agentId),
      isNull(agentMemories.supersededBy),
    ))

  const cutoff = Date.now() - DECAY_STALE_DAYS * 86_400_000
  let flagged = 0
  let stale = 0
  for (const m of memories) {
    if (computeFlags(m.content).length > 0) flagged++
    if (m.updatedAt < cutoff) stale++
  }

  let lastConsolidatedAt = lastConsolidated.get(agentId) ?? null
  let lastActions = lastRunSummaries.get(agentId) ?? null

  if (!lastConsolidatedAt) {
    const fromLog = await readLastRunFromLog(agentId)
    lastConsolidatedAt = fromLog.lastConsolidatedAt
    lastActions = fromLog.lastActions
    if (lastConsolidatedAt) lastConsolidated.set(agentId, lastConsolidatedAt)
    if (lastActions) lastRunSummaries.set(agentId, lastActions)
  }

  return {
    totalActive: memories.length,
    flagged,
    stale,
    skippedFlagged: lastSkippedFlagged.get(agentId) ?? 0,
    lastConsolidatedAt,
    lastActions,
    recentChanges: lastRecentChanges.get(agentId) ?? {},
  }
}

export async function triggerManualConsolidation(
  agentId: string,
  entries: Array<{ repoId: string; client: RuntimeClient }>,
): Promise<void> {
  if (entries.length === 0) throw new Error("No runtime clients available")
  if (consolidatingAgents.has(agentId)) throw new Error("Consolidation already in progress")

  const client = entries[0].client
  consolidatingAgents.add(agentId)
  try {
    await consolidateAgent(agentId, client)
    lastConsolidated.set(agentId, Date.now())
    const decayResult = await applyImportanceDecay(agentId)
    const prev = lastRunSummaries.get(agentId)
    if (prev) {
      prev.decayed = decayResult.decayed
    } else {
      lastRunSummaries.set(agentId, { update: 0, merge: 0, delete: 0, skip: 0, decayed: decayResult.decayed })
    }
    const prevChanges = lastRecentChanges.get(agentId) ?? {}
    Object.assign(prevChanges, decayResult.changes)
    lastRecentChanges.set(agentId, prevChanges)
  } finally {
    consolidatingAgents.delete(agentId)
  }
}

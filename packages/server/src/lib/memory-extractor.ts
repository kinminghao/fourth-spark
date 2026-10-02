import { and, desc, eq, gt, inArray, isNotNull, isNull, like, lt, lte, not, or, sql } from "drizzle-orm"
import { db } from "../db/index"
import { getMessagesFromDB, getTodosFromDB } from "../db/query"
import type { MemoryVersion } from "../db/schema"
import { agentMemories, customAgents, sessions as sessionsTable } from "../db/schema"
import { logger } from "../middleware/logger"

export type ExtractionAction =
  | { action: "add"; content: string; category: string; importance: number }
  | { action: "update"; targetId: string; content: string; importance: number }
  | { action: "merge"; targetIds: string[]; content: string; category: string; importance: number }
  | { action: "reinforce"; targetId: string; reason: string }
  | { action: "skip"; targetId: string; reason: string }
  | { action: "delete"; targetId: string; reason: string }

const MAX_PROMPT_CHARS = 24_000
const MAX_EXISTING_MEMORIES = 100
const MAX_NEW_MEMORIES = 3
const TOOL_SUMMARY_LIMIT = 200
const MAX_EXTRACTION_CONTENT_LENGTH = 200
export const MAX_CONSOLIDATION_CONTENT_LENGTH = 600
const SENTINEL_PATTERNS = /\[\/?\s*AGENT\s*MEMORY\s*\]|<\|.*?\|>|^system\s*:/gim

export const EXTRACTION_MAX_ATTEMPTS = 3
export const EXTRACTION_RETRY_BACKOFF_MS = [4 * 60 * 60 * 1_000, 24 * 60 * 60 * 1_000]
export const EXTRACTION_CLAIM_LEASE_MS = 15 * 60 * 1_000
export const EXTRACTION_SKIP_STALE_DAYS = 7

export interface ExtractionCandidate {
  id: string
  customAgentId: string
  timeUpdated: number
  lastExtractionAt: number | null
  extractionAttempts: number
  extractionRetryAt: number | null
  latestMemoryAt: number | null
}

export type ExtractionClaimMode = "scheduled" | "manual"

export interface ExtractionClaim {
  attempts: number
  claimedVersion: number
  leaseUntil: number
}

export type ExtractionRunOutcome =
  | { kind: "completed"; actionCount: number; rawCount: number; rejectedCount: number; applied: number }
  | { kind: "failed"; error: string }

export interface ExtractionScanCandidates {
  due: Array<{ id: string; customAgentId: string }>
  skippedStale: number
}

export function isStaleBacklog(candidate: ExtractionCandidate, now: number): boolean {
  return (
    candidate.lastExtractionAt === null &&
    candidate.latestMemoryAt === null &&
    candidate.timeUpdated < now - EXTRACTION_SKIP_STALE_DAYS * 86_400_000
  )
}

export function isExtractionDue(candidate: ExtractionCandidate, now: number): boolean {
  const gateOpen = candidate.extractionRetryAt === null || candidate.extractionRetryAt <= now
  if (!gateOpen) return false
  const watermark = candidate.lastExtractionAt ?? candidate.latestMemoryAt ?? 0
  if (candidate.timeUpdated > watermark) return true
  return candidate.extractionRetryAt !== null && candidate.extractionAttempts < EXTRACTION_MAX_ATTEMPTS
}

function newMemoryId(): string {
  return `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`
}

export function sanitizeMemoryContent(content: string, maxLength = MAX_EXTRACTION_CONTENT_LENGTH): string {
  return content.slice(0, maxLength).replace(SENTINEL_PATTERNS, "")
}

export const FORBIDDEN_CONTENT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /#\d+/, reason: "contains PR/Issue number" },
  { pattern: /\b\d{2,}\s*行\b/, reason: "contains line count" },
  { pattern: /\.(ts|tsx|js|jsx|py|go|rs|sql|md|json)\b/, reason: "contains file extension" },
  { pattern: /\b[a-f0-9]{7,40}\b/, reason: "contains hash-like token" },
  { pattern: /表的.*字段|字段.*语义/, reason: "references specific DB schema" },
  { pattern: /```/, reason: "contains code block" },
]

export function validateMemoryContent(
  content: string,
  opts: { maxLength?: number; skipForbiddenPatterns?: boolean } = {},
): { ok: true } | { ok: false; reason: string } {
  const maxLength = opts.maxLength ?? MAX_EXTRACTION_CONTENT_LENGTH
  if (content.length > maxLength) return { ok: false, reason: `too long (${content.length} chars)` }
  if (content.length < 5) return { ok: false, reason: "too short" }
  if (!opts.skipForbiddenPatterns) {
    for (const { pattern, reason } of FORBIDDEN_CONTENT_PATTERNS) {
      if (pattern.test(content)) return { ok: false, reason }
    }
  }
  return { ok: true }
}

export function normalizeCategory(category: unknown): string {
  if (typeof category === "string" && category.trim().length > 0) return category.trim()
  return "general"
}

export interface ExtractionInputData {
  messages: Array<{ role: string; content: string }>
  todos: Array<{ status: string; content: string }>
  memories: Array<{ id: string; category: string; content: string; importance: number }>
}

export async function buildExtractionData(
  sessionId: string,
  customAgentId: string,
): Promise<ExtractionInputData | null> {
  const dbMessages = await getMessagesFromDB(sessionId)
  if (dbMessages.length === 0) return null

  const lines: Array<{ role: string; content: string }> = []
  for (const msg of dbMessages) {
    const role = msg.role === "user" ? "用户" : "助手"
    for (const part of msg.parts ?? []) {
      if (part.type === "thinking") continue

      if (part.type === "text") {
        const p = part as Record<string, unknown>
        const text = (p.content as string) ?? (p.text as string) ?? ""
        if (text.trim()) lines.push({ role, content: text })
      } else if (part.type === "tool-call" || part.type === "tool-result") {
        const toolName =
          ((part as Record<string, unknown>).toolName as string) ??
          ((part as Record<string, unknown>).tool as string) ??
          "tool"
        const input = JSON.stringify((part as Record<string, unknown>).input ?? "").slice(0, TOOL_SUMMARY_LIMIT)
        const output = JSON.stringify((part as Record<string, unknown>).output ?? "").slice(0, TOOL_SUMMARY_LIMIT)
        if (part.type === "tool-call") {
          lines.push({ role: "工具调用", content: `${toolName}(${input})` })
        } else {
          lines.push({ role: "工具结果", content: `${toolName} → ${output}` })
        }
      }
    }
  }

  // Truncate: keep head + tail within MAX_PROMPT_CHARS
  let messages = lines
  const totalLen = lines.reduce((s, l) => s + l.role.length + l.content.length + 4, 0)
  if (totalLen > MAX_PROMPT_CHARS) {
    const head = lines.slice(0, 4)
    const headLen = head.reduce((s, l) => s + l.role.length + l.content.length + 4, 0)
    const remaining = Math.max(0, MAX_PROMPT_CHARS - headLen - 200)
    const tail: typeof lines = []
    let tailLen = 0
    for (let i = lines.length - 1; i >= 4; i--) {
      const entryLen = lines[i].role.length + lines[i].content.length + 4
      if (tailLen + entryLen > remaining) break
      tail.unshift(lines[i])
      tailLen += entryLen
    }
    const skipped = lines.length - 4 - tail.length
    messages = [...head, { role: "系统", content: `[... 省略 ${skipped} 条中间对话 ...]` }, ...tail]
  }

  const todos = (await getTodosFromDB(sessionId)).map((t) => ({ status: t.status, content: t.content }))

  const existing = await db
    .select()
    .from(agentMemories)
    .where(and(eq(agentMemories.customAgentId, customAgentId), isNull(agentMemories.supersededBy)))
    .orderBy(desc(agentMemories.importance))
    .limit(MAX_EXISTING_MEMORIES)

  const memories = existing.map((m) => ({
    id: m.id,
    category: m.category,
    content: m.content,
    importance: m.importance,
  }))

  return { messages, todos, memories }
}

export function buildFullExtractionPrompt(systemPrompt: string, inputPath: string, outputPath: string): string {
  return `${systemPrompt}\n\n输入文件路径：${inputPath}\n输出文件路径：${outputPath}\n\n请先用 Read 工具读取输入文件，分析其中的对话数据，然后用 Write 工具将 JSON 结果写入输出文件。`
}

export interface ParseOptions {
  maxLength?: number
  skipForbiddenPatterns?: boolean
}

export type ExtractionOutput =
  | { kind: "parsed"; actions: ExtractionAction[]; rawCount: number; rejectedCount: number }
  | { kind: "invalid"; reason: string }

export function parseExtractionOutput(text: string, opts: ParseOptions = {}): ExtractionOutput {
  const candidates: string[] = [text]

  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenced?.[1]) candidates.push(fenced[1])

  const arrayMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/)
  if (arrayMatch) candidates.push(arrayMatch[0])

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (Array.isArray(parsed)) {
        const actions = validateActions(parsed, opts)
        return { kind: "parsed", actions, rawCount: parsed.length, rejectedCount: parsed.length - actions.length }
      }
    } catch {
      /* try next candidate */
    }
  }

  logger.warn({ text: text.slice(0, 200) }, "failed to parse extraction result as JSON")
  return { kind: "invalid", reason: "unparseable output" }
}

export function parseExtractionResult(text: string, opts: ParseOptions = {}): ExtractionAction[] {
  const output = parseExtractionOutput(text, opts)
  return output.kind === "parsed" ? output.actions : []
}

function validateActions(raw: unknown[], opts: ParseOptions = {}): ExtractionAction[] {
  const actions: ExtractionAction[] = []
  let addCount = 0
  const maxLen = opts.maxLength ?? MAX_EXTRACTION_CONTENT_LENGTH
  const skipForbidden = opts.skipForbiddenPatterns ?? false

  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const obj = item as Record<string, unknown>
    const action = obj.action as string

    switch (action) {
      case "add": {
        if (addCount >= MAX_NEW_MEMORIES) continue
        if (typeof obj.content !== "string" || !obj.content) continue
        const addContent = sanitizeMemoryContent(obj.content, maxLen)
        const addCheck = validateMemoryContent(addContent, { maxLength: maxLen, skipForbiddenPatterns: skipForbidden })
        if (!addCheck.ok) {
          logger.info({ reason: addCheck.reason, content: addContent.slice(0, 80) }, "memory rejected (add)")
          continue
        }
        addCount++
        actions.push({
          action: "add",
          content: addContent,
          category: normalizeCategory(obj.category),
          importance: typeof obj.importance === "number" ? Math.max(0, Math.min(1, obj.importance)) : 0.5,
        })
        break
      }

      case "update": {
        if (typeof obj.targetId !== "string" || typeof obj.content !== "string") continue
        const updateContent = sanitizeMemoryContent(obj.content, maxLen)
        const updateCheck = validateMemoryContent(updateContent, {
          maxLength: maxLen,
          skipForbiddenPatterns: skipForbidden,
        })
        if (!updateCheck.ok) {
          logger.info(
            { reason: updateCheck.reason, targetId: obj.targetId, content: updateContent.slice(0, 80) },
            "memory rejected (update)",
          )
          continue
        }
        actions.push({
          action: "update",
          targetId: obj.targetId,
          content: updateContent,
          importance: typeof obj.importance === "number" ? Math.max(0, Math.min(1, obj.importance)) : 0.5,
        })
        break
      }

      case "merge": {
        if (!Array.isArray(obj.targetIds) || typeof obj.content !== "string") continue
        const mergeContent = sanitizeMemoryContent(obj.content, maxLen)
        const mergeCheck = validateMemoryContent(mergeContent, {
          maxLength: maxLen,
          skipForbiddenPatterns: skipForbidden,
        })
        if (!mergeCheck.ok) {
          logger.info(
            { reason: mergeCheck.reason, targetIds: obj.targetIds, content: mergeContent.slice(0, 80) },
            "memory rejected (merge)",
          )
          continue
        }
        actions.push({
          action: "merge",
          targetIds: obj.targetIds.filter((id): id is string => typeof id === "string"),
          content: mergeContent,
          category: normalizeCategory(obj.category),
          importance: typeof obj.importance === "number" ? Math.max(0, Math.min(1, obj.importance)) : 0.5,
        })
        break
      }

      case "reinforce":
        if (typeof obj.targetId !== "string") continue
        actions.push({
          action: "reinforce",
          targetId: obj.targetId,
          reason: typeof obj.reason === "string" ? obj.reason : "",
        })
        break

      case "skip":
        if (typeof obj.targetId !== "string") continue
        actions.push({
          action: "skip",
          targetId: obj.targetId,
          reason: typeof obj.reason === "string" ? obj.reason : "",
        })
        break
    }
  }

  return actions
}

export async function executeActions(
  customAgentId: string,
  sessionId: string,
  actions: ExtractionAction[],
): Promise<{ applied: number; failed: number }> {
  const now = Date.now()
  let applied = 0
  let failed = 0

  for (const action of actions) {
    try {
      switch (action.action) {
        case "add": {
          const id = newMemoryId()
          const createVersion: MemoryVersion = {
            content: action.content,
            importance: action.importance,
            category: action.category,
            action: "create",
            ts: now,
            source: sessionId,
          }
          await db.insert(agentMemories).values({
            id,
            customAgentId,
            sessionId,
            content: action.content,
            category: action.category,
            importance: action.importance,
            history: [createVersion],
            createdAt: now,
            updatedAt: now,
          })
          logger.info({ memId: id, category: action.category, customAgentId, sessionId }, "memory added")
          break
        }

        case "update": {
          const [current] = await db
            .select({
              content: agentMemories.content,
              importance: agentMemories.importance,
              category: agentMemories.category,
              history: agentMemories.history,
            })
            .from(agentMemories)
            .where(and(eq(agentMemories.id, action.targetId), eq(agentMemories.customAgentId, customAgentId)))
          if (!current) break
          const prev: MemoryVersion = {
            content: current.content,
            importance: current.importance,
            category: current.category,
            action: "update",
            ts: now,
            source: sessionId,
          }
          const history = [...(current.history ?? []), prev]
          await db
            .update(agentMemories)
            .set({
              content: action.content,
              importance: action.importance,
              history,
              updatedAt: now,
            })
            .where(and(eq(agentMemories.id, action.targetId), eq(agentMemories.customAgentId, customAgentId)))
          logger.info({ memId: action.targetId, customAgentId, sessionId }, "memory updated")
          break
        }

        case "merge": {
          const newId = newMemoryId()
          await db.transaction(async (tx) => {
            const sourceRows = await tx
              .select({
                id: agentMemories.id,
                content: agentMemories.content,
                importance: agentMemories.importance,
                category: agentMemories.category,
                history: agentMemories.history,
              })
              .from(agentMemories)
              .where(and(inArray(agentMemories.id, action.targetIds), eq(agentMemories.customAgentId, customAgentId)))

            const combinedHistory: MemoryVersion[] = []
            for (const src of sourceRows) {
              if (src.history) combinedHistory.push(...src.history)
              combinedHistory.push({
                content: src.content,
                importance: src.importance,
                category: src.category,
                action: "merge",
                ts: now,
                source: sessionId,
              })
            }

            await tx.insert(agentMemories).values({
              id: newId,
              customAgentId,
              sessionId,
              mergedFrom: action.targetIds,
              content: action.content,
              category: action.category,
              importance: action.importance,
              history: combinedHistory,
              createdAt: now,
              updatedAt: now,
            })
            for (const oldId of action.targetIds) {
              await tx
                .update(agentMemories)
                .set({
                  supersededBy: newId,
                  updatedAt: now,
                })
                .where(and(eq(agentMemories.id, oldId), eq(agentMemories.customAgentId, customAgentId)))
            }
          })
          logger.info({ newId, merged: action.targetIds, customAgentId, sessionId }, "memories merged")
          break
        }

        case "reinforce": {
          const [existing] = await db
            .select({
              importance: agentMemories.importance,
              content: agentMemories.content,
              category: agentMemories.category,
              history: agentMemories.history,
            })
            .from(agentMemories)
            .where(and(eq(agentMemories.id, action.targetId), eq(agentMemories.customAgentId, customAgentId)))
          if (existing) {
            const newImportance = Math.min(existing.importance * 1.2, 1.0)
            const prev: MemoryVersion = {
              content: existing.content,
              importance: existing.importance,
              category: existing.category,
              action: "reinforce",
              ts: now,
              source: sessionId,
            }
            const history = [...(existing.history ?? []), prev]
            await db
              .update(agentMemories)
              .set({
                importance: newImportance,
                history,
                updatedAt: now,
              })
              .where(eq(agentMemories.id, action.targetId))
            logger.info({ memId: action.targetId, importance: newImportance, customAgentId }, "memory reinforced")
          }
          break
        }

        case "delete": {
          const [current] = await db
            .select({
              content: agentMemories.content,
              importance: agentMemories.importance,
              category: agentMemories.category,
              history: agentMemories.history,
            })
            .from(agentMemories)
            .where(and(eq(agentMemories.id, action.targetId), eq(agentMemories.customAgentId, customAgentId)))
          if (!current) break
          const prev: MemoryVersion = {
            content: current.content,
            importance: current.importance,
            category: current.category,
            action: "update",
            ts: now,
            source: sessionId,
          }
          const history = [...(current.history ?? []), prev]
          await db
            .update(agentMemories)
            .set({
              supersededBy: "consolidated-out",
              history,
              updatedAt: now,
            })
            .where(and(eq(agentMemories.id, action.targetId), eq(agentMemories.customAgentId, customAgentId)))
          logger.info(
            { memId: action.targetId, reason: action.reason, customAgentId, sessionId },
            "memory deleted (consolidated-out)",
          )
          break
        }

        case "skip": {
          await db
            .update(agentMemories)
            .set({ updatedAt: now })
            .where(and(eq(agentMemories.id, action.targetId), eq(agentMemories.customAgentId, customAgentId)))
          break
        }
      }
      applied++
    } catch (err) {
      failed++
      logger.error({ err, action: action.action, customAgentId, sessionId }, "failed to execute memory action")
    }
  }

  return { applied, failed }
}

export async function processExtractionOutput(
  customAgentId: string,
  sessionId: string,
  resultText: string | null,
): Promise<ExtractionRunOutcome> {
  if (resultText === null || resultText.trim().length === 0) {
    return { kind: "failed", error: "extraction output file missing or empty" }
  }

  const output = parseExtractionOutput(resultText)
  if (output.kind === "invalid") {
    return { kind: "failed", error: output.reason }
  }

  if (output.actions.length === 0) {
    return {
      kind: "completed",
      actionCount: 0,
      rawCount: output.rawCount,
      rejectedCount: output.rejectedCount,
      applied: 0,
    }
  }

  const exec = await executeActions(customAgentId, sessionId, output.actions)
  if (exec.failed > 0) {
    return { kind: "failed", error: `${exec.failed} of ${output.actions.length} actions failed to persist` }
  }

  return {
    kind: "completed",
    actionCount: output.actions.length,
    rawCount: output.rawCount,
    rejectedCount: output.rejectedCount,
    applied: exec.applied,
  }
}

export async function getSessionCustomAgentId(sessionId: string): Promise<string | null> {
  const [session] = await db
    .select({ customAgentId: sessionsTable.customAgentId })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
  if (!session?.customAgentId) return null

  const [agent] = await db
    .select({ memoryEnabled: customAgents.memoryEnabled })
    .from(customAgents)
    .where(eq(customAgents.id, session.customAgentId))
  if (agent?.memoryEnabled !== 1) return null

  return session.customAgentId
}

export async function claimExtractionAttempt(
  sessionId: string,
  mode: ExtractionClaimMode = "scheduled",
): Promise<ExtractionClaim | null> {
  const now = Date.now()
  const leaseUntil = now + EXTRACTION_CLAIM_LEASE_MS

  const rows = await db
    .update(sessionsTable)
    .set(
      mode === "manual"
        ? {
            extractionAttempts: 1,
            lastExtractionAt: sql`${sessionsTable.timeUpdated}`,
            extractionRetryAt: leaseUntil,
          }
        : {
            extractionAttempts: sql`CASE WHEN ${sessionsTable.timeUpdated} > COALESCE(${sessionsTable.lastExtractionAt}, 0) THEN 1 ELSE ${sessionsTable.extractionAttempts} + 1 END`,
            lastExtractionAt: sql`${sessionsTable.timeUpdated}`,
            extractionRetryAt: leaseUntil,
          },
    )
    .where(
      mode === "manual"
        ? and(
            eq(sessionsTable.id, sessionId),
            or(
              isNull(sessionsTable.extractionRetryAt),
              lte(sessionsTable.extractionRetryAt, now),
              gt(sessionsTable.extractionRetryAt, now + EXTRACTION_CLAIM_LEASE_MS),
            ),
          )
        : and(
            eq(sessionsTable.id, sessionId),
            or(isNull(sessionsTable.extractionRetryAt), lte(sessionsTable.extractionRetryAt, now)),
            or(
              sql`${sessionsTable.timeUpdated} > COALESCE(${sessionsTable.lastExtractionAt}, (SELECT max(agent_memories.created_at) FROM agent_memories WHERE agent_memories.session_id = ${sessionsTable.id}), 0)`,
              and(
                isNotNull(sessionsTable.extractionRetryAt),
                lt(sessionsTable.extractionAttempts, EXTRACTION_MAX_ATTEMPTS),
              ),
            ),
          ),
    )
    .returning({
      attempts: sessionsTable.extractionAttempts,
      claimedVersion: sessionsTable.lastExtractionAt,
    })

  const row = rows[0]
  if (!row) return null
  return { attempts: row.attempts, claimedVersion: row.claimedVersion ?? 0, leaseUntil }
}

export async function settleExtractionSuccess(sessionId: string, leaseUntil: number): Promise<boolean> {
  const rows = await db
    .update(sessionsTable)
    .set({ extractionAttempts: 0, extractionRetryAt: null })
    .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.extractionRetryAt, leaseUntil)))
    .returning({ id: sessionsTable.id })
  return rows.length > 0
}

export async function settleExtractionFailure(
  sessionId: string,
  attempts: number,
  leaseUntil: number,
): Promise<boolean> {
  const retryAt = attempts >= EXTRACTION_MAX_ATTEMPTS ? null : Date.now() + EXTRACTION_RETRY_BACKOFF_MS[attempts - 1]
  const rows = await db
    .update(sessionsTable)
    .set({ extractionRetryAt: retryAt })
    .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.extractionRetryAt, leaseUntil)))
    .returning({ id: sessionsTable.id })
  return rows.length > 0
}

export async function listExtractableSessions(): Promise<ExtractionScanCandidates> {
  const rows = await db
    .select({
      id: sessionsTable.id,
      customAgentId: sessionsTable.customAgentId,
      timeUpdated: sessionsTable.timeUpdated,
      lastExtractionAt: sessionsTable.lastExtractionAt,
      extractionAttempts: sessionsTable.extractionAttempts,
      extractionRetryAt: sessionsTable.extractionRetryAt,
      latestMemoryAt: sql<
        number | null
      >`(SELECT max(created_at)::double precision FROM agent_memories WHERE session_id = ${sessionsTable.id})`,
    })
    .from(sessionsTable)
    .innerJoin(customAgents, eq(sessionsTable.customAgentId, customAgents.id))
    .where(
      and(
        isNotNull(sessionsTable.customAgentId),
        eq(customAgents.memoryEnabled, 1),
        not(like(sessionsTable.title, "[internal]%")),
      ),
    )

  const now = Date.now()
  const candidates: ExtractionCandidate[] = []
  let skippedStale = 0
  for (const row of rows) {
    if (!row.customAgentId) continue
    const candidate: ExtractionCandidate = {
      id: row.id,
      customAgentId: row.customAgentId,
      timeUpdated: row.timeUpdated,
      lastExtractionAt: row.lastExtractionAt,
      extractionAttempts: row.extractionAttempts,
      extractionRetryAt: row.extractionRetryAt,
      latestMemoryAt: row.latestMemoryAt,
    }
    if (isStaleBacklog(candidate, now)) {
      skippedStale++
      continue
    }
    if (isExtractionDue(candidate, now)) candidates.push(candidate)
  }

  candidates.sort((a, b) => (a.lastExtractionAt ?? 0) - (b.lastExtractionAt ?? 0) || b.timeUpdated - a.timeUpdated)

  return { due: candidates.map((c) => ({ id: c.id, customAgentId: c.customAgentId })), skippedStale }
}

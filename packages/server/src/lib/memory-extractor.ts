import { eq, and, isNull, isNotNull, desc, inArray, not, like } from "drizzle-orm"
import { db } from "../db/index"
import { agentMemories, sessions as sessionsTable, customAgents } from "../db/schema"
import type { MemoryVersion } from "../db/schema"
import { getMessagesFromDB, getTodosFromDB } from "../db/query"
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

// Strip structural context headers injected by the server into historical messages.
// Without this, the extractor (running as Sisyphus) may interpret [WORKSPACE] /
// [AGENT MEMORY] blocks as its own current context and treat data content as live tasks.
const MSG_WORKSPACE_BLOCK = /\[WORKSPACE\][\s\S]*?\[\/WORKSPACE\]/g
const MSG_AGENT_MEMORY_BLOCK = /\[AGENT MEMORY\][\s\S]*/

function sanitizeMessageContent(text: string): string {
  return text
    .replace(MSG_WORKSPACE_BLOCK, "[工作区]")
    .replace(MSG_AGENT_MEMORY_BLOCK, "")
    .trim()
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

export async function buildExtractionData(sessionId: string, customAgentId: string): Promise<ExtractionInputData | null> {
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
        const sanitized = sanitizeMessageContent(text)
        if (sanitized) lines.push({ role, content: sanitized })
      } else if (part.type === "tool-call" || part.type === "tool-result") {
        const toolName = (part as Record<string, unknown>).toolName as string ?? (part as Record<string, unknown>).tool as string ?? "tool"
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

  const todos = (await getTodosFromDB(sessionId)).map(t => ({ status: t.status, content: t.content }))

  const existing = await db.select().from(agentMemories)
    .where(and(
      eq(agentMemories.customAgentId, customAgentId),
      isNull(agentMemories.supersededBy),
    ))
    .orderBy(desc(agentMemories.importance))
    .limit(MAX_EXISTING_MEMORIES)

  const memories = existing.map(m => ({ id: m.id, category: m.category, content: m.content, importance: m.importance }))

  return { messages, todos, memories }
}

export function buildFullExtractionPrompt(systemPrompt: string, inputPath: string, outputPath: string): string {
  return `${systemPrompt}\n\n输入文件路径：${inputPath}\n输出文件路径：${outputPath}\n\n请先用 Read 工具读取输入文件，分析其中的对话数据，然后用 Write 工具将 JSON 结果写入输出文件。`
}

export interface ParseOptions {
  maxLength?: number
  skipForbiddenPatterns?: boolean
}

export function parseExtractionResult(text: string, opts: ParseOptions = {}): ExtractionAction[] {
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return validateActions(parsed, opts)
  } catch { /* fallback */ }

  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (match?.[1]) {
    try {
      const parsed = JSON.parse(match[1])
      if (Array.isArray(parsed)) return validateActions(parsed, opts)
    } catch { /* ignore */ }
  }

  const arrayMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/)
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0])
      if (Array.isArray(parsed)) return validateActions(parsed, opts)
    } catch { /* ignore */ }
  }

  logger.warn({ text: text.slice(0, 200) }, "failed to parse extraction result as JSON")
  return []
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
        const updateCheck = validateMemoryContent(updateContent, { maxLength: maxLen, skipForbiddenPatterns: skipForbidden })
        if (!updateCheck.ok) {
          logger.info({ reason: updateCheck.reason, targetId: obj.targetId, content: updateContent.slice(0, 80) }, "memory rejected (update)")
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
        const mergeCheck = validateMemoryContent(mergeContent, { maxLength: maxLen, skipForbiddenPatterns: skipForbidden })
        if (!mergeCheck.ok) {
          logger.info({ reason: mergeCheck.reason, targetIds: obj.targetIds, content: mergeContent.slice(0, 80) }, "memory rejected (merge)")
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

export async function executeActions(customAgentId: string, sessionId: string, actions: ExtractionAction[]): Promise<void> {
  const now = Date.now()

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
          const [current] = await db.select({
            content: agentMemories.content,
            importance: agentMemories.importance,
            category: agentMemories.category,
            history: agentMemories.history,
          }).from(agentMemories).where(and(
            eq(agentMemories.id, action.targetId),
            eq(agentMemories.customAgentId, customAgentId),
          ))
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
          await db.update(agentMemories).set({
            content: action.content,
            importance: action.importance,
            history,
            updatedAt: now,
          }).where(and(
            eq(agentMemories.id, action.targetId),
            eq(agentMemories.customAgentId, customAgentId),
          ))
          logger.info({ memId: action.targetId, customAgentId, sessionId }, "memory updated")
          break
        }

        case "merge": {
          const newId = newMemoryId()
          await db.transaction(async (tx) => {
            const sourceRows = await tx.select({
              id: agentMemories.id,
              content: agentMemories.content,
              importance: agentMemories.importance,
              category: agentMemories.category,
              history: agentMemories.history,
            }).from(agentMemories).where(and(
              inArray(agentMemories.id, action.targetIds),
              eq(agentMemories.customAgentId, customAgentId),
            ))

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
              await tx.update(agentMemories).set({
                supersededBy: newId,
                updatedAt: now,
              }).where(and(
                eq(agentMemories.id, oldId),
                eq(agentMemories.customAgentId, customAgentId),
              ))
            }
          })
          logger.info({ newId, merged: action.targetIds, customAgentId, sessionId }, "memories merged")
          break
        }

        case "reinforce": {
          const [existing] = await db.select({
            importance: agentMemories.importance,
            content: agentMemories.content,
            category: agentMemories.category,
            history: agentMemories.history,
          }).from(agentMemories).where(and(
            eq(agentMemories.id, action.targetId),
            eq(agentMemories.customAgentId, customAgentId),
          ))
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
            await db.update(agentMemories).set({
              importance: newImportance,
              history,
              updatedAt: now,
            }).where(eq(agentMemories.id, action.targetId))
            logger.info({ memId: action.targetId, importance: newImportance, customAgentId }, "memory reinforced")
          }
          break
        }

        case "delete": {
          const [current] = await db.select({
            content: agentMemories.content,
            importance: agentMemories.importance,
            category: agentMemories.category,
            history: agentMemories.history,
          }).from(agentMemories).where(and(
            eq(agentMemories.id, action.targetId),
            eq(agentMemories.customAgentId, customAgentId),
          ))
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
          await db.update(agentMemories).set({
            supersededBy: "consolidated-out",
            history,
            updatedAt: now,
          }).where(and(
            eq(agentMemories.id, action.targetId),
            eq(agentMemories.customAgentId, customAgentId),
          ))
          logger.info({ memId: action.targetId, reason: action.reason, customAgentId, sessionId }, "memory deleted (consolidated-out)")
          break
        }

        case "skip": {
          await db.update(agentMemories).set({ updatedAt: now })
            .where(and(
              eq(agentMemories.id, action.targetId),
              eq(agentMemories.customAgentId, customAgentId),
            ))
          break
        }
      }
    } catch (err) {
      logger.error({ err, action: action.action, customAgentId, sessionId }, "failed to execute memory action")
    }
  }
}

export async function getSessionCustomAgentId(sessionId: string): Promise<string | null> {
  const [session] = await db.select({ customAgentId: sessionsTable.customAgentId })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
  if (!session?.customAgentId) return null

  const [agent] = await db.select({ memoryEnabled: customAgents.memoryEnabled })
    .from(customAgents)
    .where(eq(customAgents.id, session.customAgentId))
  if (!agent || agent.memoryEnabled !== 1) return null

  return session.customAgentId
}

export async function sessionNeedsExtraction(sessionId: string): Promise<boolean> {
  const [session] = await db.select({ timeUpdated: sessionsTable.timeUpdated })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
  if (!session) return false

  const [latestMemory] = await db.select({ createdAt: agentMemories.createdAt })
    .from(agentMemories)
    .where(eq(agentMemories.sessionId, sessionId))
    .orderBy(desc(agentMemories.createdAt))
    .limit(1)

  if (!latestMemory) return true
  return session.timeUpdated > latestMemory.createdAt
}

export async function listExtractableSessions(): Promise<Array<{ id: string; customAgentId: string }>> {
  const rows = await db.select({
    id: sessionsTable.id,
    customAgentId: sessionsTable.customAgentId,
    timeUpdated: sessionsTable.timeUpdated,
  })
    .from(sessionsTable)
    .innerJoin(customAgents, eq(sessionsTable.customAgentId, customAgents.id))
    .where(and(
      isNotNull(sessionsTable.customAgentId),
      eq(customAgents.memoryEnabled, 1),
      not(like(sessionsTable.title, "[internal]%")),
    ))

  const result: Array<{ id: string; customAgentId: string }> = []
  for (const row of rows) {
    if (!row.customAgentId) continue
    const needs = await sessionNeedsExtraction(row.id)
    if (needs) result.push({ id: row.id, customAgentId: row.customAgentId })
  }
  return result
}

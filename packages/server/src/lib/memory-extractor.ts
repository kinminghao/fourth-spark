import { eq, and, isNull, desc } from "drizzle-orm"
import { db } from "../db/index"
import { agentMemories, sessions as sessionsTable, customAgents } from "../db/schema"
import { getMessagesFromDB, getTodosFromDB } from "../db/query"
import { logger } from "../middleware/logger"

export type ExtractionAction =
  | { action: "add"; content: string; category: string; importance: number }
  | { action: "update"; targetId: string; content: string; importance: number }
  | { action: "merge"; targetIds: string[]; content: string; category: string; importance: number }
  | { action: "reinforce"; targetId: string; reason: string }
  | { action: "skip"; targetId: string; reason: string }

const MAX_PROMPT_CHARS = 24_000
const MAX_EXISTING_MEMORIES = 20
const MAX_NEW_MEMORIES = 5
const TOOL_SUMMARY_LIMIT = 200
const MAX_MEMORY_CONTENT_LENGTH = 1000
const VALID_CATEGORIES = new Set(["general", "decision", "lesson", "preference", "pattern"])
const SENTINEL_PATTERNS = /\[\/?\s*AGENT\s*MEMORY\s*\]|<\|.*?\|>|^system\s*:/gim

function newMemoryId(): string {
  return `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`
}

function sanitizeMemoryContent(content: string): string {
  return content.slice(0, MAX_MEMORY_CONTENT_LENGTH).replace(SENTINEL_PATTERNS, "")
}

function normalizeCategory(category: unknown): string {
  if (typeof category === "string" && VALID_CATEGORIES.has(category)) return category
  return "general"
}

export async function buildExtractionPrompt(sessionId: string, customAgentId: string): Promise<string> {
  const messages = await getMessagesFromDB(sessionId)
  if (messages.length === 0) return ""

  const lines: string[] = []
  for (const msg of messages) {
    const role = msg.role === "user" ? "用户" : "助手"
    for (const part of msg.parts ?? []) {
      if (part.type === "thinking") continue

      if (part.type === "text") {
        const text = ((part as Record<string, unknown>).content as string) ?? ""
        if (text.trim()) lines.push(`[${role}] ${text}`)
      } else if (part.type === "tool-call" || part.type === "tool-result") {
        const toolName = (part as Record<string, unknown>).toolName as string ?? "tool"
        const input = JSON.stringify((part as Record<string, unknown>).input ?? "").slice(0, TOOL_SUMMARY_LIMIT)
        const output = JSON.stringify((part as Record<string, unknown>).output ?? "").slice(0, TOOL_SUMMARY_LIMIT)
        if (part.type === "tool-call") {
          lines.push(`[工具调用] ${toolName}(${input})`)
        } else {
          lines.push(`[工具结果] ${toolName} → ${output}`)
        }
      }
    }
  }

  let conversation = lines.join("\n")
  if (conversation.length > MAX_PROMPT_CHARS) {
    const head = lines.slice(0, 4).join("\n").slice(0, MAX_PROMPT_CHARS / 2)
    const remaining = Math.max(0, MAX_PROMPT_CHARS - head.length - 200)
    const tail: string[] = []
    let tailLen = 0
    for (let i = lines.length - 1; i >= 4; i--) {
      if (tailLen + lines[i].length > remaining) break
      tail.unshift(lines[i])
      tailLen += lines[i].length + 1
    }
    const skipped = lines.length - 4 - tail.length
    conversation = `${head}\n\n[... 省略 ${skipped} 条中间对话 ...]\n\n${tail.join("\n")}`
  }

  const todos = await getTodosFromDB(sessionId)
  let todoSummary = ""
  if (todos.length > 0) {
    const todoLines = todos.map(t => `- [${t.status}] ${t.content}`)
    todoSummary = `\n\n## Todo 最终状态\n${todoLines.join("\n")}`
  }

  const existing = await db.select().from(agentMemories)
    .where(and(
      eq(agentMemories.customAgentId, customAgentId),
      isNull(agentMemories.supersededBy),
    ))
    .orderBy(desc(agentMemories.importance))
    .limit(MAX_EXISTING_MEMORIES)

  let existingBlock = ""
  if (existing.length > 0) {
    const memLines = existing.map(m => `[${m.id}] [${m.category}] ${m.content} (importance: ${m.importance})`)
    existingBlock = `\n\n## 已有记忆\n${memLines.join("\n")}`
  }

  return `## 对话历史\n${conversation}${todoSummary}${existingBlock}`
}

export function parseExtractionResult(text: string): ExtractionAction[] {
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return validateActions(parsed)
  } catch { /* fallback */ }

  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (match?.[1]) {
    try {
      const parsed = JSON.parse(match[1])
      if (Array.isArray(parsed)) return validateActions(parsed)
    } catch { /* ignore */ }
  }

  const arrayMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/)
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0])
      if (Array.isArray(parsed)) return validateActions(parsed)
    } catch { /* ignore */ }
  }

  logger.warn({ text: text.slice(0, 200) }, "failed to parse extraction result as JSON")
  return []
}

function validateActions(raw: unknown[]): ExtractionAction[] {
  const actions: ExtractionAction[] = []
  let addCount = 0

  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const obj = item as Record<string, unknown>
    const action = obj.action as string

    switch (action) {
      case "add":
        if (addCount >= MAX_NEW_MEMORIES) continue
        if (typeof obj.content !== "string" || !obj.content) continue
        addCount++
        actions.push({
          action: "add",
          content: sanitizeMemoryContent(obj.content),
          category: normalizeCategory(obj.category),
          importance: typeof obj.importance === "number" ? Math.max(0, Math.min(1, obj.importance)) : 0.5,
        })
        break

      case "update":
        if (typeof obj.targetId !== "string" || typeof obj.content !== "string") continue
        actions.push({
          action: "update",
          targetId: obj.targetId,
          content: sanitizeMemoryContent(obj.content),
          importance: typeof obj.importance === "number" ? Math.max(0, Math.min(1, obj.importance)) : 0.5,
        })
        break

      case "merge":
        if (!Array.isArray(obj.targetIds) || typeof obj.content !== "string") continue
        actions.push({
          action: "merge",
          targetIds: obj.targetIds.filter((id): id is string => typeof id === "string"),
          content: sanitizeMemoryContent(obj.content),
          category: normalizeCategory(obj.category),
          importance: typeof obj.importance === "number" ? Math.max(0, Math.min(1, obj.importance)) : 0.5,
        })
        break

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
          await db.insert(agentMemories).values({
            id,
            customAgentId,
            sessionId,
            content: action.content,
            category: action.category,
            importance: action.importance,
            createdAt: now,
            updatedAt: now,
          })
          logger.info({ memId: id, category: action.category, customAgentId, sessionId }, "memory added")
          break
        }

        case "update": {
          await db.update(agentMemories).set({
            content: action.content,
            importance: action.importance,
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
            await tx.insert(agentMemories).values({
              id: newId,
              customAgentId,
              sessionId,
              mergedFrom: action.targetIds,
              content: action.content,
              category: action.category,
              importance: action.importance,
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
          const [existing] = await db.select({ importance: agentMemories.importance })
            .from(agentMemories)
            .where(and(
              eq(agentMemories.id, action.targetId),
              eq(agentMemories.customAgentId, customAgentId),
            ))
          if (existing) {
            const newImportance = Math.min(existing.importance * 1.2, 1.0)
            await db.update(agentMemories).set({
              importance: newImportance,
              updatedAt: now,
            }).where(eq(agentMemories.id, action.targetId))
            logger.info({ memId: action.targetId, importance: newImportance, customAgentId }, "memory reinforced")
          }
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

  const [agent] = await db.select({ isSystem: customAgents.isSystem })
    .from(customAgents)
    .where(eq(customAgents.id, session.customAgentId))
  if (!agent || agent.isSystem === 1) return null

  return session.customAgentId
}

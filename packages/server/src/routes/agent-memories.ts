import { Hono } from "hono"
import { eq, and, isNull, desc, inArray } from "drizzle-orm"
import { db } from "../db/index"
import { agentMemories, customAgents, sessions as sessionsTable } from "../db/schema"
import { runtimeManager } from "../lib/process-manager"
import { buildExtractionPrompt, parseExtractionResult, executeActions } from "../lib/memory-extractor"
import { MEMORY_EXTRACTOR_ID, MEMORY_EXTRACTOR_PROMPT } from "../lib/system-agents"
import { resolveAgent } from "../lib/agent-validator"
import { syncMessagesList } from "../db/sync"
import { DEFAULT_VARIANT } from "../lib/config"
import { logger } from "../middleware/logger"
import type { RuntimeClient } from "../core/runtime-client"

async function requireNonSystemAgent(agentId: string): Promise<{ error?: string; status?: number }> {
  const [agent] = await db.select({ id: customAgents.id, isSystem: customAgents.isSystem })
    .from(customAgents)
    .where(eq(customAgents.id, agentId))
  if (!agent) return { error: "Custom agent not found", status: 404 }
  if (agent.isSystem === 1) return { error: "Cannot manage memories for system agents", status: 403 }
  return {}
}

export const agentMemoryRoutes = new Hono()

agentMemoryRoutes.get("/", async (c) => {
  const agentId = c.req.param("agentId")
  if (!agentId) return c.json({ error: "Missing agentId", status: 400 }, 400)

  const check = await requireNonSystemAgent(agentId)
  if (check.error) return c.json({ error: check.error, status: check.status }, check.status as 403 | 404)

  const category = c.req.query("category")
  const includeSuperseded = c.req.query("includeSuperseded") === "true"

  const conditions = [eq(agentMemories.customAgentId, agentId)]
  if (!includeSuperseded) {
    conditions.push(isNull(agentMemories.supersededBy))
  }
  if (category) {
    conditions.push(eq(agentMemories.category, category))
  }

  const rows = await db.select().from(agentMemories)
    .where(and(...conditions))
    .orderBy(desc(agentMemories.importance), desc(agentMemories.updatedAt))

  return c.json(rows)
})

agentMemoryRoutes.post("/", async (c) => {
  const agentId = c.req.param("agentId")
  if (!agentId) return c.json({ error: "Missing agentId", status: 400 }, 400)

  const check = await requireNonSystemAgent(agentId)
  if (check.error) return c.json({ error: check.error, status: check.status }, check.status as 403 | 404)

  const body = await c.req.json<{ content: string; category?: string; importance?: number }>()
  if (!body.content) return c.json({ error: "content is required", status: 400 }, 400)

  const now = Date.now()
  const id = `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`

  const [row] = await db.insert(agentMemories).values({
    id,
    customAgentId: agentId,
    sessionId: null,
    content: body.content,
    category: body.category ?? "general",
    importance: body.importance ?? 0.5,
    createdAt: now,
    updatedAt: now,
  }).returning()

  return c.json(row, 201)
})

agentMemoryRoutes.put("/:memId", async (c) => {
  const agentId = c.req.param("agentId")
  const memId = c.req.param("memId")
  if (!agentId || !memId) return c.json({ error: "Missing agentId or memId", status: 400 }, 400)

  const check = await requireNonSystemAgent(agentId)
  if (check.error) return c.json({ error: check.error, status: check.status }, check.status as 403 | 404)

  const body = await c.req.json<{ content?: string; category?: string; importance?: number }>()

  const [existing] = await db.select().from(agentMemories)
    .where(and(eq(agentMemories.id, memId), eq(agentMemories.customAgentId, agentId)))
  if (!existing) return c.json({ error: "Memory not found", status: 404 }, 404)

  const updates: Record<string, unknown> = { updatedAt: Date.now() }
  if (body.content !== undefined) updates.content = body.content
  if (body.category !== undefined) updates.category = body.category
  if (body.importance !== undefined) updates.importance = body.importance

  const [row] = await db.update(agentMemories).set(updates).where(eq(agentMemories.id, memId)).returning()
  return c.json(row)
})

agentMemoryRoutes.delete("/:memId", async (c) => {
  const agentId = c.req.param("agentId")
  const memId = c.req.param("memId")
  if (!agentId || !memId) return c.json({ error: "Missing agentId or memId", status: 400 }, 400)

  const check = await requireNonSystemAgent(agentId)
  if (check.error) return c.json({ error: check.error, status: check.status }, check.status as 403 | 404)

  const [existing] = await db.select().from(agentMemories)
    .where(and(eq(agentMemories.id, memId), eq(agentMemories.customAgentId, agentId)))
  if (!existing) return c.json({ error: "Memory not found", status: 404 }, 404)

  await db.update(agentMemories).set({ supersededBy: "user-deleted", updatedAt: Date.now() }).where(eq(agentMemories.id, memId))
  return c.json({ ok: true })
})

async function findClientForSession(sessionId: string): Promise<{ repoId: string; client: RuntimeClient } | null> {
  const { repos: repoRows } = await import("../db/schema").then(s => ({ repos: s.repos }))
  const allRepoRows = await db.select({ id: repoRows.id }).from(repoRows)
  for (const repo of allRepoRows) {
    const client = runtimeManager.getClient(repo.id)
    if (!client) continue
    try {
      await client.getSession(sessionId)
      return { repoId: repo.id, client }
    } catch { continue }
  }
  return null
}

agentMemoryRoutes.post("/extract", async (c) => {
  const agentId = c.req.param("agentId")
  if (!agentId) return c.json({ error: "Missing agentId", status: 400 }, 400)

  const check = await requireNonSystemAgent(agentId)
  if (check.error) return c.json({ error: check.error, status: check.status }, check.status as 403 | 404)

  const body = await c.req.json<{ sessionIds: string[] }>()
  if (!body.sessionIds?.length) return c.json({ error: "sessionIds is required", status: 400 }, 400)

  const validSessions = await db.select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(and(
      inArray(sessionsTable.id, body.sessionIds),
      eq(sessionsTable.customAgentId, agentId),
    ))

  if (validSessions.length === 0) return c.json({ error: "No matching sessions found", status: 404 }, 404)

  const results: Array<{ sessionId: string; status: string; actions?: number; error?: string; debug?: Record<string, unknown> }> = []

  for (const session of validSessions) {
    try {
      const found = await findClientForSession(session.id)
      if (!found) { results.push({ sessionId: session.id, status: "error", error: "no running client found" }); continue }
      const { client } = found

      try {
        const msgs = await client.getMessages(session.id)
        syncMessagesList(session.id, msgs)
        await new Promise(r => setTimeout(r, 500))
      } catch { /* best-effort */ }

      const prompt = await buildExtractionPrompt(session.id, agentId)
      if (!prompt) { results.push({ sessionId: session.id, status: "skipped", error: "no content to extract" }); continue }

      const agent = await resolveAgent(client, "Sisyphus - ultraworker")
      const extractionSession = await client.createSession({ agent, title: `[internal] memory extraction` })

      await db.insert(sessionsTable).values({
        id: extractionSession.id, title: `[internal] memory extraction`,
        customAgentId: MEMORY_EXTRACTOR_ID, agent: agent ?? null,
        timeCreated: Date.now(), timeUpdated: Date.now(),
      }).onConflictDoUpdate({ target: sessionsTable.id, set: { customAgentId: MEMORY_EXTRACTOR_ID, timeUpdated: Date.now() } })

      const fullPrompt = `${MEMORY_EXTRACTOR_PROMPT}\n\n---\n\n${prompt}`
      await client.prompt(extractionSession.id, fullPrompt, { agent, variant: DEFAULT_VARIANT })

      let resultText = ""
      const startedAt = Date.now()
      const TIMEOUT = 120_000

      while (Date.now() - startedAt < TIMEOUT) {
        await new Promise(r => setTimeout(r, 2_000))
        try {
          const statuses = await client.getSessionStatus()
          const s = statuses[extractionSession.id]
          if (s && (s.type === "busy" || s.type === "retry")) continue
        } catch { continue }

        try {
          const messages = await client.getMessages(extractionSession.id)
          const lastAssistant = [...messages].reverse().find(m => m.role === "assistant")
          if (lastAssistant?.parts) {
            resultText = lastAssistant.parts
              .filter(p => p.type === "text")
              .map(p => { const r = p as Record<string, unknown>; return (r.content as string) ?? (r.text as string) ?? "" })
              .join("\n").trim()
          }
          if (!resultText && lastAssistant) {
            results.push({
              sessionId: session.id, status: "error", error: "assistant responded but no text extracted",
              debug: {
                partsCount: lastAssistant.parts?.length ?? 0,
                partTypes: lastAssistant.parts?.map(p => p.type) ?? [],
                rawFirstPart: lastAssistant.parts?.[0] ? JSON.stringify(lastAssistant.parts[0]).slice(0, 500) : null,
              },
            })
            client.deleteSession(extractionSession.id).catch(() => {})
            continue
          }
        } catch (err) {
          results.push({ sessionId: session.id, status: "error", error: `getMessages failed: ${err}` })
          client.deleteSession(extractionSession.id).catch(() => {})
          continue
        }
        break
      }

      client.deleteSession(extractionSession.id).catch(() => {})

      if (!resultText) { results.push({ sessionId: session.id, status: "error", error: "timeout or empty result" }); continue }

      const actions = parseExtractionResult(resultText)
      if (actions.length > 0) {
        await executeActions(agentId, session.id, actions)
        results.push({ sessionId: session.id, status: "ok", actions: actions.length })
      } else {
        results.push({ sessionId: session.id, status: "empty", error: "parsed 0 actions", debug: { resultTextPreview: resultText.slice(0, 300) } })
      }
    } catch (err) {
      results.push({ sessionId: session.id, status: "error", error: String(err) })
    }
  }

  return c.json({ results })
})

export const agentSessionRoutes = new Hono()

agentSessionRoutes.get("/", async (c) => {
  const agentId = c.req.param("agentId")
  if (!agentId) return c.json({ error: "Missing agentId", status: 400 }, 400)

  const rows = await db.select({
    id: sessionsTable.id,
    title: sessionsTable.title,
    agent: sessionsTable.agent,
    cost: sessionsTable.cost,
    tokensInput: sessionsTable.tokensInput,
    tokensOutput: sessionsTable.tokensOutput,
    timeCreated: sessionsTable.timeCreated,
    timeUpdated: sessionsTable.timeUpdated,
    completedAt: sessionsTable.completedAt,
  }).from(sessionsTable)
    .where(eq(sessionsTable.customAgentId, agentId))
    .orderBy(desc(sessionsTable.timeCreated))

  return c.json(rows)
})

import { Hono } from "hono"
import { eq, and, isNull, desc } from "drizzle-orm"
import { db } from "../db/index"
import { agentMemories, customAgents, sessions as sessionsTable } from "../db/schema"

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

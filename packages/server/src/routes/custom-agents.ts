import { Hono } from "hono"
import { eq, or, and, isNull, asc, inArray } from "drizzle-orm"
import { db } from "../db/index"
import { customAgents, customAgentFragments, promptFragments } from "../db/schema"

const ALLOWED_BASE_AGENTS = ["Sisyphus - ultraworker", "Prometheus - Plan Builder", "Atlas - Plan Executor"]

type FragmentInfo = { id: string; name: string; content: string }

async function attachFragments<T extends { id: string }>(agents: T[]): Promise<(T & { fragments: FragmentInfo[] })[]> {
  if (agents.length === 0) return []
  const ids = agents.map((a) => a.id)
  const joins = await db.select({
    customAgentId: customAgentFragments.customAgentId,
    position: customAgentFragments.position,
    id: promptFragments.id,
    name: promptFragments.name,
    content: promptFragments.content,
  })
    .from(customAgentFragments)
    .innerJoin(promptFragments, eq(customAgentFragments.fragmentId, promptFragments.id))
    .where(inArray(customAgentFragments.customAgentId, ids))
    .orderBy(asc(customAgentFragments.position))

  const map = new Map<string, FragmentInfo[]>()
  for (const j of joins) {
    const list = map.get(j.customAgentId) ?? []
    list.push({ id: j.id, name: j.name, content: j.content })
    map.set(j.customAgentId, list)
  }
  return agents.map((a) => ({ ...a, fragments: map.get(a.id) ?? [] }))
}

async function syncFragmentIds(agentId: string, fragmentIds: string[]) {
  await db.delete(customAgentFragments).where(eq(customAgentFragments.customAgentId, agentId))
  if (fragmentIds.length > 0) {
    await db.insert(customAgentFragments).values(
      fragmentIds.map((fid, i) => ({ customAgentId: agentId, fragmentId: fid, position: i })),
    )
  }
}

export const globalCustomAgents = new Hono()

globalCustomAgents.get("/", async (c) => {
  const rows = await db.select().from(customAgents)
    .where(isNull(customAgents.repoId))
    .orderBy(asc(customAgents.sortOrder), asc(customAgents.createdAt))
  return c.json(await attachFragments(rows))
})

globalCustomAgents.post("/", async (c) => {
  const body = await c.req.json<{
    name?: string
    baseAgent?: string
    model?: string
    systemPrompt?: string
    fragmentIds?: string[]
  }>().catch(() => null)

  if (!body?.name || !body?.baseAgent) {
    return c.json({ error: "name and baseAgent are required" }, 400)
  }
  if (!ALLOWED_BASE_AGENTS.includes(body.baseAgent)) {
    return c.json({ error: `baseAgent must be one of: ${ALLOWED_BASE_AGENTS.join(", ")}` }, 400)
  }

  const now = Date.now()
  const row = {
    id: crypto.randomUUID(),
    name: body.name.trim(),
    baseAgent: body.baseAgent,
    model: body.model?.trim() || null,
    systemPrompt: body.systemPrompt ?? "",
    repoId: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(customAgents).values(row)
  if (body.fragmentIds?.length) await syncFragmentIds(row.id, body.fragmentIds)
  const [result] = await attachFragments([row])
  return c.json(result, 201)
})

globalCustomAgents.put("/:id", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{
    name?: string
    baseAgent?: string
    model?: string | null
    systemPrompt?: string
    sortOrder?: number
    fragmentIds?: string[]
  }>().catch(() => null)
  if (!body) return c.json({ error: "empty body" }, 400)

  if (body.baseAgent && !ALLOWED_BASE_AGENTS.includes(body.baseAgent)) {
    return c.json({ error: `baseAgent must be one of: ${ALLOWED_BASE_AGENTS.join(", ")}` }, 400)
  }

  const updates: Record<string, unknown> = { updatedAt: Date.now() }
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.baseAgent !== undefined) updates.baseAgent = body.baseAgent
  if (body.model !== undefined) updates.model = body.model?.trim() || null
  if (body.systemPrompt !== undefined) updates.systemPrompt = body.systemPrompt
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder

  await db.update(customAgents).set(updates).where(eq(customAgents.id, id))
  if (body.fragmentIds !== undefined) await syncFragmentIds(id, body.fragmentIds)
  const [row] = await db.select().from(customAgents).where(eq(customAgents.id, id))
  if (!row) return c.json({ error: "not found" }, 404)
  const [result] = await attachFragments([row])
  return c.json(result)
})

globalCustomAgents.delete("/:id", async (c) => {
  await db.delete(customAgents).where(eq(customAgents.id, c.req.param("id")))
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Export — GET /api/custom-agents/:id/export
// ---------------------------------------------------------------------------

globalCustomAgents.get("/:id/export", async (c) => {
  const [agent] = await db.select().from(customAgents).where(eq(customAgents.id, c.req.param("id")))
  if (!agent) return c.json({ error: "not found" }, 404)

  const [withFragments] = await attachFragments([agent])
  return c.json({
    version: 1,
    type: "fourth-spark-custom-agent",
    exportedAt: Date.now(),
    agent: {
      name: withFragments.name,
      baseAgent: withFragments.baseAgent,
      model: withFragments.model,
      systemPrompt: withFragments.systemPrompt,
    },
    fragments: withFragments.fragments.map((f) => ({ name: f.name, content: f.content })),
  })
})

// ---------------------------------------------------------------------------
// Import — POST /api/custom-agents/import
// ---------------------------------------------------------------------------

globalCustomAgents.post("/import", async (c) => {
  const body = await c.req.json<{
    version?: number
    type?: string
    agent?: { name?: string; baseAgent?: string; model?: string | null; systemPrompt?: string }
    fragments?: Array<{ name?: string; content?: string }>
  }>().catch(() => null)

  if (!body || body.type !== "fourth-spark-custom-agent" || !body.agent) {
    return c.json({ error: "invalid import format: expected fourth-spark-custom-agent JSON" }, 400)
  }
  const { agent: agentData, fragments: fragData = [] } = body
  if (!agentData.name || !agentData.baseAgent) {
    return c.json({ error: "agent name and baseAgent are required" }, 400)
  }
  if (!ALLOWED_BASE_AGENTS.includes(agentData.baseAgent)) {
    return c.json({ error: `baseAgent must be one of: ${ALLOWED_BASE_AGENTS.join(", ")}` }, 400)
  }

  const now = Date.now()

  // Upsert fragments — reuse existing by name+content match, create new ones otherwise
  const fragmentIds: string[] = []
  for (const frag of fragData) {
    if (!frag.name) continue
    const content = frag.content ?? ""
    const [existing] = await db.select({ id: promptFragments.id })
      .from(promptFragments)
      .where(and(eq(promptFragments.name, frag.name), eq(promptFragments.content, content), isNull(promptFragments.repoId)))
      .limit(1)

    if (existing) {
      fragmentIds.push(existing.id)
    } else {
      const fragId = crypto.randomUUID()
      await db.insert(promptFragments).values({
        id: fragId,
        name: frag.name,
        content,
        repoId: null,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      })
      fragmentIds.push(fragId)
    }
  }

  const row = {
    id: crypto.randomUUID(),
    name: agentData.name.trim(),
    baseAgent: agentData.baseAgent,
    model: agentData.model?.trim() || null,
    systemPrompt: agentData.systemPrompt ?? "",
    repoId: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(customAgents).values(row)
  if (fragmentIds.length > 0) await syncFragmentIds(row.id, fragmentIds)

  const [result] = await attachFragments([row])
  return c.json(result, 201)
})

export const repoCustomAgents = new Hono()

repoCustomAgents.get("/", async (c) => {
  const repoId = c.req.param("repoId")!
  const rows = await db.select().from(customAgents)
    .where(or(isNull(customAgents.repoId), eq(customAgents.repoId, repoId)))
    .orderBy(asc(customAgents.sortOrder), asc(customAgents.createdAt))
  return c.json(await attachFragments(rows))
})

repoCustomAgents.post("/", async (c) => {
  const repoId = c.req.param("repoId")!
  const body = await c.req.json<{
    name?: string
    baseAgent?: string
    model?: string
    systemPrompt?: string
    fragmentIds?: string[]
  }>().catch(() => null)

  if (!body?.name || !body?.baseAgent) {
    return c.json({ error: "name and baseAgent are required" }, 400)
  }
  if (!ALLOWED_BASE_AGENTS.includes(body.baseAgent)) {
    return c.json({ error: `baseAgent must be one of: ${ALLOWED_BASE_AGENTS.join(", ")}` }, 400)
  }

  const now = Date.now()
  const row = {
    id: crypto.randomUUID(),
    name: body.name.trim(),
    baseAgent: body.baseAgent,
    model: body.model?.trim() || null,
    systemPrompt: body.systemPrompt ?? "",
    repoId,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(customAgents).values(row)
  if (body.fragmentIds?.length) await syncFragmentIds(row.id, body.fragmentIds)
  const [result] = await attachFragments([row])
  return c.json(result, 201)
})

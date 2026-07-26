import { Hono } from "hono"
import { eq, asc, desc, inArray } from "drizzle-orm"
import { processManager } from "../lib/process-manager"
import { DEFAULT_VARIANT } from "../lib/config"
import { syncSessionsList, syncMessagesList } from "../db/sync"
import { getRepoDirectory, listSessionsFromDB, getSessionFromDB, getMessagesFromDB, getTodosFromDB } from "../db/query"
import { db } from "../db/index"
import { sessions as sessionsTable, issues, issueComments, customAgents, customAgentFragments, promptFragments } from "../db/schema"
import { logger } from "../middleware/logger"
import type { SessionStatus } from "../lib/opencode"

export const sessions = new Hono()

function stripMedia(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<a[^>]+href="[^"]*attachments[^"]*"[^>]*>.*?<\/a>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const MAX_ANCESTOR_DEPTH = 10
const MAX_ANCESTOR_COMMENTS = 5

async function collectAncestorChain(issueId: string) {
  const chain: (typeof issues.$inferSelect)[] = []
  const visited = new Set<string>()
  let currentId: string | null = issueId

  while (currentId && chain.length < MAX_ANCESTOR_DEPTH) {
    if (visited.has(currentId)) break
    visited.add(currentId)
    const [issue] = await db.select().from(issues).where(eq(issues.id, currentId))
    if (!issue) break
    chain.push(issue)
    currentId = issue.parentId
  }

  return chain.reverse()
}

async function buildIssueContext(issueId: string): Promise<string | null> {
  const chain = await collectAncestorChain(issueId)
  if (chain.length === 0) return null

  const allIds = chain.map((i) => i.id)
  const allComments = await db.select().from(issueComments)
    .where(inArray(issueComments.issueId, allIds))
    .orderBy(asc(issueComments.createdAt))

  const commentMap = Map.groupBy(allComments, (c) => c.issueId)

  const sections = chain.map((issue, i) => {
    const isLeaf = i === chain.length - 1
    const header = isLeaf
      ? `## 当前 Issue: [#${issue.number}] ${issue.title}`
      : `## 上级 Issue (Level ${i}): [#${issue.number}] ${issue.title}`

    const parts = [header]

    if (issue.body) {
      const cleaned = stripMedia(issue.body)
      if (cleaned) parts.push(cleaned)
    }

    let comments = commentMap.get(issue.id) ?? []
    if (!isLeaf && comments.length > MAX_ANCESTOR_COMMENTS) {
      comments = comments.slice(-MAX_ANCESTOR_COMMENTS)
    }
    if (comments.length > 0) {
      const lines = comments.map((c) => {
        const date = new Date(c.createdAt).toISOString().slice(0, 10)
        const cleaned = stripMedia(c.body)
        return `**${c.authorLogin}** (${date}):\n${cleaned}`
      })
      parts.push(`### Comments\n\n${lines.join("\n\n")}`)
    }

    return parts.join("\n\n")
  })

  return sections.join("\n\n---\n\n")
}

sessions.post("/", async (c) => {
  const repoId = c.req.param("repoId")
  const client = processManager.requireClient(repoId)
  const body = await c.req.json<{ message?: string; agent?: string; model?: string; variant?: string; title?: string; issueId?: string; customAgentId?: string }>().catch(() => null)
  if (!body || typeof body.message !== "string" || body.message.length === 0) {
    return c.json({ error: "Body must include a non-empty 'message' string", status: 400 }, 400)
  }

  let agent = body.agent
  let model = body.model
  let systemPrompt: string | undefined
  let customAgentId: string | null = null

  if (body.customAgentId) {
    const [ca] = await db.select().from(customAgents).where(eq(customAgents.id, body.customAgentId))
    if (ca) {
      customAgentId = ca.id
      agent = ca.baseAgent
      if (ca.model) model = ca.model
      if (ca.systemPrompt) systemPrompt = ca.systemPrompt
    }
  }

  const parts: string[] = []
  if (customAgentId) {
    const frags = await db.select({ content: promptFragments.content })
      .from(customAgentFragments)
      .innerJoin(promptFragments, eq(customAgentFragments.fragmentId, promptFragments.id))
      .where(eq(customAgentFragments.customAgentId, customAgentId))
      .orderBy(asc(customAgentFragments.position))
    for (const f of frags) {
      if (f.content) parts.push(f.content)
    }
  }
  if (systemPrompt) parts.push(systemPrompt)
  if (body.issueId) {
    const context = await buildIssueContext(body.issueId)
    if (context) parts.push(context)
  }
  parts.push(body.message)
  const prompt = parts.join("\n\n---\n\n")

  const session = await client.createSession({ agent, title: body.title })
  const now = Date.now()
  await db.insert(sessionsTable).values({
    id: session.id,
    title: session.title ?? body.title ?? "",
    issueId: body.issueId ?? null,
    customAgentId,
    agent: agent ?? null,
    timeCreated: now,
    timeUpdated: now,
  }).onConflictDoUpdate({
    target: sessionsTable.id,
    set: { issueId: body.issueId ?? null, customAgentId, timeUpdated: now },
  })
  await client.prompt(session.id, prompt, { agent, model, variant: body.variant ?? DEFAULT_VARIANT })
  return c.json({ ...session, agent, issueId: body.issueId ?? null, customAgentId }, 201)
})

sessions.get("/", async (c) => {
  const repoId = c.req.param("repoId")
  const client = processManager.getClient(repoId)
  if (client) {
    try {
      const list = await client.listSessions()
      syncSessionsList(list)
      const ids = list.map((s) => s.id)
      const issueRows = ids.length > 0
        ? await db.select({ id: sessionsTable.id, issueId: sessionsTable.issueId }).from(sessionsTable).where(inArray(sessionsTable.id, ids))
        : []
      const issueMap = new Map(issueRows.map((r) => [r.id, r.issueId]))
      return c.json(list.map((s) => ({ ...s, issueId: issueMap.get(s.id) ?? null })))
    } catch (err) {
      logger.warn({ err, repoId }, "opencode unavailable for listSessions, falling back to DB")
    }
  }
  const directory = await getRepoDirectory(repoId!)
  if (!directory) return c.json([])
  return c.json(await listSessionsFromDB(directory))
})

sessions.get("/:id", async (c) => {
  const repoId = c.req.param("repoId")
  const sessionId = c.req.param("id")
  const client = processManager.getClient(repoId)
  if (client) {
    try {
      const live = await client.getSession(sessionId)
      const dbSession = await getSessionFromDB(sessionId)
      if (dbSession) {
        return c.json({ ...live, cost: dbSession.cost, tokens: dbSession.tokens, model: dbSession.model })
      }
      return c.json(live)
    } catch (err) {
      logger.warn({ err, repoId }, "opencode unavailable for getSession, falling back to DB")
    }
  }
  const session = await getSessionFromDB(sessionId)
  if (!session) return c.json({ error: "Session not found", status: 404 }, 404)
  return c.json(session)
})

sessions.delete("/:id", async (c) => {
  const client = processManager.requireClient(c.req.param("repoId"))
  await client.deleteSession(c.req.param("id"))
  return c.json({ ok: true })
})

sessions.post("/:id/prompt", async (c) => {
  const client = processManager.requireClient(c.req.param("repoId"))
  const body = await c.req.json<{ content?: string; agent?: string; model?: string; variant?: string }>().catch(() => null)
  if (!body || typeof body.content !== "string" || body.content.length === 0) {
    return c.json({ error: "Body must include a non-empty 'content' string", status: 400 }, 400)
  }
  await client.prompt(c.req.param("id"), body.content, { agent: body.agent, model: body.model, variant: body.variant ?? DEFAULT_VARIANT })
  return c.json({ ok: true })
})

sessions.post("/:id/abort", async (c) => {
  const client = processManager.requireClient(c.req.param("repoId"))
  await client.abort(c.req.param("id"))
  return c.json({ ok: true })
})

sessions.get("/:id/messages", async (c) => {
  const repoId = c.req.param("repoId")
  const id = c.req.param("id")
  const client = processManager.getClient(repoId)
  if (client) {
    try {
      const msgs = await client.getMessages(id)
      syncMessagesList(id, msgs)
      return c.json(msgs)
    } catch (err) {
      logger.warn({ err, repoId }, "opencode unavailable for getMessages, falling back to DB")
    }
  }
  return c.json(await getMessagesFromDB(id))
})

sessions.get("/:id/todos", async (c) => {
  const repoId = c.req.param("repoId")
  const client = processManager.getClient(repoId)
  if (client) {
    try {
      return c.json(await client.getTodos(c.req.param("id")))
    } catch (err) {
      logger.warn({ err, repoId }, "opencode unavailable for getTodos, falling back to DB")
    }
  }
  return c.json(await getTodosFromDB(c.req.param("id")))
})

sessions.patch("/:id", async (c) => {
  const sessionId = c.req.param("id")
  const body = await c.req.json<{ issueId?: string | null }>().catch(() => null)
  if (!body) return c.json({ error: "empty body" }, 400)
  if ("issueId" in body) {
    await db.update(sessionsTable).set({ issueId: body.issueId ?? null }).where(eq(sessionsTable.id, sessionId))
  }
  return c.json({ ok: true })
})

sessions.get("/:id/status", async (c) => {
  const repoId = c.req.param("repoId")
  const client = processManager.getClient(repoId)
  if (client) {
    try {
      const all = await client.getSessionStatus()
      const status: SessionStatus = all[c.req.param("id")] ?? { type: "idle" }
      return c.json(status)
    } catch {
      // Process down → session is idle
    }
  }
  return c.json({ type: "idle" } satisfies SessionStatus)
})

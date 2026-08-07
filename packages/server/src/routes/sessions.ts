import { Hono } from "hono"
import { eq, and, asc, inArray } from "drizzle-orm"
import { processManager } from "../lib/process-manager"
import { sessionMonitor } from "../lib/session-monitor"
import { workspaceManager } from "../lib/workspace-manager"
import { DEFAULT_VARIANT } from "../lib/config"
import { syncSessionsList, syncMessagesList } from "../db/sync"
import { getRepoDirectory, listSessionsFromDB, getSessionFromDB, getMessagesFromDB, getTodosFromDB } from "../db/query"
import { db } from "../db/index"
import { sessions as sessionsTable, issues, issueComments, customAgents, customAgentFragments, promptFragments, sessionLinks, pullRequests, repos, workspaces } from "../db/schema"
import { logger } from "../middleware/logger"
import { createOpenCodeClient } from "../lib/opencode"
import type { SessionStatus } from "../lib/opencode"

export const sessions = new Hono()

async function getScopedClient(repoId: string, sessionId: string) {
  const client = processManager.requireClient(repoId)
  const [row] = await db.select({ workspaceId: sessionsTable.workspaceId })
    .from(sessionsTable).where(eq(sessionsTable.id, sessionId))
  if (row?.workspaceId) {
    const [ws] = await db.select({ localPath: workspaces.localPath })
      .from(workspaces).where(eq(workspaces.id, row.workspaceId))
    if (ws) return createOpenCodeClient(client.baseUrl, ws.localPath)
  }
  return client
}

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

export async function buildIssueContext(issueId: string): Promise<string | null> {
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
  if (!repoId) {
    return c.json({ error: "Missing repoId", status: 400 }, 400)
  }
  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId))
  if (!repo) {
    return c.json({ error: "Repo not found", status: 404 }, 404)
  }

  const body = await c.req.json<{ message?: string; agent?: string; model?: string; variant?: string; title?: string; issueId?: string; customAgentId?: string }>().catch(() => null)
  if (!body) {
    return c.json({ error: "Request body is required", status: 400 }, 400)
  }
  const message = typeof body.message === "string" ? body.message.trim() : ""
  const hasContext = Boolean(body.issueId) || Boolean(body.customAgentId)
  if (!message && !hasContext) {
    return c.json({ error: "Either a non-empty 'message', an 'issueId', or a 'customAgentId' is required", status: 400 }, 400)
  }

  let agent = body.agent
  let model = body.model
  let systemPrompt: string | undefined
  let systemPromptPosition = -1
  let customAgentId: string | null = null

  if (body.customAgentId) {
    const [ca] = await db.select().from(customAgents).where(eq(customAgents.id, body.customAgentId))
    if (ca) {
      customAgentId = ca.id
      agent = ca.baseAgent
      if (ca.model) model = ca.model
      if (ca.systemPrompt) systemPrompt = ca.systemPrompt
      systemPromptPosition = ca.systemPromptPosition
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
  if (systemPrompt) {
    const insertAt = systemPromptPosition >= 0 && systemPromptPosition <= parts.length
      ? systemPromptPosition
      : parts.length
    parts.splice(insertAt, 0, systemPrompt)
  }
  if (body.issueId) {
    const context = await buildIssueContext(body.issueId)
    if (context) parts.push(context)
  }
  if (message) parts.push(message)
  const prompt = parts.join("\n\n---\n\n")

  const repoClient = processManager.requireClient(repoId)

  const workspace = await workspaceManager.create(repoId, repo.localPath)
  const wsClient = createOpenCodeClient(repoClient.baseUrl, workspace.localPath)

  let session
  try {
    session = await wsClient.createSession({ agent, title: body.title })
  } catch (err) {
    logger.error({ err, workspaceId: workspace.id, repoId }, "createSession failed, cleaning up workspace")
    await workspaceManager.remove(workspace.id).catch(() => {})
    throw err
  }

  const now = Date.now()
  await db.insert(sessionsTable).values({
    id: session.id,
    title: session.title ?? body.title ?? "",
    workspaceId: workspace.id,
    issueId: body.issueId ?? null,
    customAgentId,
    agent: agent ?? null,
    timeCreated: now,
    timeUpdated: now,
  }).onConflictDoUpdate({
    target: sessionsTable.id,
    set: { workspaceId: workspace.id, issueId: body.issueId ?? null, customAgentId, timeUpdated: now },
  })
  try {
    await wsClient.prompt(session.id, prompt, { agent, model, variant: body.variant ?? DEFAULT_VARIANT })
  } catch (err) {
    logger.error({ err, sessionId: session.id, agent, model }, "prompt failed after session creation, cleaning up")
    await wsClient.deleteSession(session.id).catch(() => {})
    await db.delete(sessionsTable).where(eq(sessionsTable.id, session.id)).catch(() => {})
    await workspaceManager.remove(workspace.id).catch(() => {})
    throw err
  }
  return c.json({ ...session, agent, issueId: body.issueId ?? null, customAgentId, workspaceId: workspace.id }, 201)
})

sessions.get("/", async (c) => {
  const repoId = c.req.param("repoId")
  const client = processManager.getClient(repoId)
  if (client) {
    try {
      const clients = [client]
      const repoWorkspaces = await workspaceManager.listByRepo(repoId!)
      for (const ws of repoWorkspaces) {
        clients.push(createOpenCodeClient(client.baseUrl, ws.localPath))
      }

      const allSessions = (await Promise.all(clients.map((cl) => cl.listSessions().catch(() => [])))).flat()
      const seen = new Map<string, (typeof allSessions)[0]>()
      for (const s of allSessions) {
        if (!seen.has(s.id)) seen.set(s.id, s)
      }
      const list = [...seen.values()]

      syncSessionsList(list)
      const ids = list.map((s) => s.id)
      const dbRows = ids.length > 0
        ? await db.select({ id: sessionsTable.id, issueId: sessionsTable.issueId, title: sessionsTable.title, parentId: sessionsTable.parentId, completedAt: sessionsTable.completedAt }).from(sessionsTable).where(inArray(sessionsTable.id, ids))
        : []
      const dbMap = new Map(dbRows.map((r) => [r.id, r]))
      return c.json(list.map((s) => {
        const row = dbMap.get(s.id)
        return {
          ...s,
          issueId: row?.issueId ?? null,
          ...(row?.title ? { title: row.title } : {}),
          ...(row?.parentId && !s.parentID ? { parentID: row.parentId } : {}),
          ...(row?.completedAt ? { completedAt: row.completedAt } : {}),
        }
      }))
    } catch (err) {
      logger.warn({ err, repoId }, "opencode unavailable for listSessions, falling back to DB")
    }
  }
  const directory = await getRepoDirectory(repoId!)
  if (!directory) return c.json([])
  return c.json(await listSessionsFromDB(directory))
})

// Bulk status — returns all session statuses in one call.
// MUST be registered before /:id to avoid being shadowed by the param route.
sessions.get("/all-links", async (c) => {
  const allLinks = await db.select().from(sessionLinks)
  const issueIds = [...new Set(allLinks.filter((l) => l.type === "issue").map((l) => l.targetId))]
  const prIds = [...new Set(allLinks.filter((l) => l.type === "pr").map((l) => l.targetId))]

  const issueRows = issueIds.length > 0
    ? await db.select({ id: issues.id, number: issues.number, title: issues.title, state: issues.state }).from(issues).where(inArray(issues.id, issueIds))
    : []
  const prRows = prIds.length > 0
    ? await db.select({ id: pullRequests.id, number: pullRequests.number, title: pullRequests.title, state: pullRequests.state, mergedAt: pullRequests.mergedAt }).from(pullRequests).where(inArray(pullRequests.id, prIds))
    : []

  const issueMap = new Map(issueRows.map((r) => [r.id, r]))
  const prMap = new Map(prRows.map((r) => [r.id, r]))

  const result: Record<string, { issues: typeof issueRows; pullRequests: typeof prRows }> = {}
  for (const link of allLinks) {
    if (!result[link.sessionId]) result[link.sessionId] = { issues: [], pullRequests: [] }
    if (link.type === "issue") {
      const row = issueMap.get(link.targetId)
      if (row) result[link.sessionId].issues.push(row)
    } else {
      const row = prMap.get(link.targetId)
      if (row) result[link.sessionId].pullRequests.push(row)
    }
  }
  return c.json(result)
})

sessions.get("/status", async (c) => {
  const repoId = c.req.param("repoId")
  const client = processManager.getClient(repoId)
  if (!client) return c.json({})
  try {
    return c.json(await client.getSessionStatus())
  } catch {
    return c.json({})
  }
})

sessions.get("/:id", async (c) => {
  const repoId = c.req.param("repoId")
  const sessionId = c.req.param("id")
  try {
    const client = await getScopedClient(repoId!, sessionId)
    const live = await client.getSession(sessionId)
    const dbSession = await getSessionFromDB(sessionId)
    if (dbSession) {
      return c.json({ ...live, cost: dbSession.cost, tokens: dbSession.tokens, model: dbSession.model })
    }
    return c.json(live)
  } catch (err) {
    logger.warn({ err, repoId }, "opencode unavailable for getSession, falling back to DB")
  }
  const session = await getSessionFromDB(sessionId)
  if (!session) return c.json({ error: "Session not found", status: 404 }, 404)
  return c.json(session)
})

sessions.delete("/:id", async (c) => {
  const client = await getScopedClient(c.req.param("repoId")!, c.req.param("id"))
  await client.deleteSession(c.req.param("id"))
  return c.json({ ok: true })
})

sessions.post("/:id/prompt", async (c) => {
  const client = await getScopedClient(c.req.param("repoId")!, c.req.param("id"))
  const body = await c.req.json<{ content?: string; agent?: string; model?: string; variant?: string }>().catch(() => null)
  if (!body || typeof body.content !== "string" || body.content.length === 0) {
    return c.json({ error: "Body must include a non-empty 'content' string", status: 400 }, 400)
  }
  await client.prompt(c.req.param("id"), body.content, { agent: body.agent, model: body.model, variant: body.variant ?? DEFAULT_VARIANT })
  return c.json({ ok: true })
})

sessions.post("/:id/abort", async (c) => {
  const sessionId = c.req.param("id")
  const client = await getScopedClient(c.req.param("repoId")!, sessionId)
  sessionMonitor.markAborted(sessionId)
  await client.abort(sessionId)
  return c.json({ ok: true })
})

sessions.post("/:id/questions/reply", async (c) => {
  const sessionId = c.req.param("id")
  const client = await getScopedClient(c.req.param("repoId")!, sessionId)
  const body = await c.req.json<{ answers?: string[][] }>().catch(() => null)
  if (!body?.answers || !Array.isArray(body.answers)) {
    return c.json({ error: "'answers' must be an array of string arrays", status: 400 }, 400)
  }
  const pending = await client.listQuestions()
  const match = pending.find((q) => q.sessionID === sessionId)
  if (!match) {
    return c.json({ error: "No pending question for this session", status: 404 }, 404)
  }
  await client.replyQuestion(match.id, body.answers)
  return c.json({ ok: true })
})

sessions.post("/:id/questions/reject", async (c) => {
  const sessionId = c.req.param("id")
  const client = await getScopedClient(c.req.param("repoId")!, sessionId)
  const pending = await client.listQuestions()
  const match = pending.find((q) => q.sessionID === sessionId)
  if (!match) {
    return c.json({ error: "No pending question for this session", status: 404 }, 404)
  }
  await client.rejectQuestion(match.id)
  return c.json({ ok: true })
})

sessions.get("/:id/messages", async (c) => {
  const repoId = c.req.param("repoId")
  const id = c.req.param("id")
  try {
    const client = await getScopedClient(repoId!, id)
    const msgs = await client.getMessages(id)
    syncMessagesList(id, msgs)
    return c.json(msgs)
  } catch (err) {
    logger.warn({ err, repoId }, "opencode unavailable for getMessages, falling back to DB")
  }
  return c.json(await getMessagesFromDB(id))
})

sessions.get("/:id/todos", async (c) => {
  const repoId = c.req.param("repoId")
  const id = c.req.param("id")
  try {
    const client = await getScopedClient(repoId!, id)
    return c.json(await client.getTodos(id))
  } catch (err) {
    logger.warn({ err, repoId }, "opencode unavailable for getTodos, falling back to DB")
  }
  return c.json(await getTodosFromDB(id))
})

sessions.patch("/:id", async (c) => {
  const sessionId = c.req.param("id")
  const body = await c.req.json<{ issueId?: string | null; title?: string; completedAt?: number | null }>().catch(() => null)
  if (!body) return c.json({ error: "empty body" }, 400)
  const updates: Record<string, unknown> = {}
  if ("issueId" in body) updates.issueId = body.issueId ?? null
  if ("title" in body && typeof body.title === "string") updates.title = body.title
  if ("completedAt" in body) updates.completedAt = body.completedAt ?? null
  if (Object.keys(updates).length > 0) {
    await db.update(sessionsTable).set(updates).where(eq(sessionsTable.id, sessionId))
  }
  return c.json({ ok: true })
})

sessions.get("/:id/links", async (c) => {
  const sessionId = c.req.param("id")
  const links = await db.select().from(sessionLinks).where(eq(sessionLinks.sessionId, sessionId))

  const issueIds = links.filter((l) => l.type === "issue").map((l) => l.targetId)
  const prIds = links.filter((l) => l.type === "pr").map((l) => l.targetId)

  const linkedIssues = issueIds.length > 0
    ? await db.select().from(issues).where(inArray(issues.id, issueIds))
    : []
  const linkedPrs = prIds.length > 0
    ? await db.select().from(pullRequests).where(inArray(pullRequests.id, prIds))
    : []

  return c.json({ issues: linkedIssues, pullRequests: linkedPrs })
})

sessions.post("/:id/links", async (c) => {
  const sessionId = c.req.param("id")
  const body = await c.req.json<{ type: "issue" | "pr"; targetId: string }>().catch(() => null)
  if (!body?.type || !body?.targetId) return c.json({ error: "type and targetId required" }, 400)
  if (body.type !== "issue" && body.type !== "pr") return c.json({ error: "type must be 'issue' or 'pr'" }, 400)
  await db.insert(sessionLinks).values({
    sessionId,
    type: body.type,
    targetId: body.targetId,
    createdAt: Date.now(),
  }).onConflictDoNothing()
  return c.json({ ok: true }, 201)
})

sessions.delete("/:id/links", async (c) => {
  const sessionId = c.req.param("id")
  const body = await c.req.json<{ type: "issue" | "pr"; targetId: string }>().catch(() => null)
  if (!body?.type || !body?.targetId) return c.json({ error: "type and targetId required" }, 400)
  await db.delete(sessionLinks)
    .where(and(
      eq(sessionLinks.sessionId, sessionId),
      eq(sessionLinks.type, body.type),
      eq(sessionLinks.targetId, body.targetId),
    ))
  return c.json({ ok: true })
})

sessions.get("/:id/status", async (c) => {
  const repoId = c.req.param("repoId")
  const id = c.req.param("id")
  try {
    const client = await getScopedClient(repoId!, id)
    const all = await client.getSessionStatus()
    const status: SessionStatus = all[id] ?? { type: "idle" }
    return c.json(status)
  } catch {
    // Process down → session is idle
  }
  return c.json({ type: "idle" } satisfies SessionStatus)
})

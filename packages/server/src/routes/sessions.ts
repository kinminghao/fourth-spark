import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { processManager } from "../lib/process-manager"
import { DEFAULT_VARIANT } from "../lib/config"
import { syncSessionsList, syncMessagesList } from "../db/sync"
import { getRepoDirectory, listSessionsFromDB, getSessionFromDB, getMessagesFromDB, getTodosFromDB } from "../db/query"
import { db } from "../db/index"
import { sessions as sessionsTable } from "../db/schema"
import { logger } from "../middleware/logger"
import type { SessionStatus } from "../lib/opencode"

export const sessions = new Hono()

sessions.post("/", async (c) => {
  const repoId = c.req.param("repoId")
  const client = processManager.requireClient(repoId)
  const body = await c.req.json<{ message?: string; agent?: string; model?: string; variant?: string; title?: string; issueId?: string }>().catch(() => null)
  if (!body || typeof body.message !== "string" || body.message.length === 0) {
    return c.json({ error: "Body must include a non-empty 'message' string", status: 400 }, 400)
  }
  const session = await client.createSession({ agent: body.agent, title: body.title })
  if (body.issueId) {
    await db.update(sessionsTable).set({ issueId: body.issueId }).where(eq(sessionsTable.id, session.id)).catch(() => {})
  }
  await client.prompt(session.id, body.message, { agent: body.agent, model: body.model, variant: body.variant ?? DEFAULT_VARIANT })
  return c.json({ ...session, agent: body.agent, issueId: body.issueId ?? null }, 201)
})

sessions.get("/", async (c) => {
  const repoId = c.req.param("repoId")
  const client = processManager.getClient(repoId)
  if (client) {
    try {
      const list = await client.listSessions()
      syncSessionsList(list)
      return c.json(list)
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
  const client = processManager.getClient(repoId)
  if (client) {
    try {
      return c.json(await client.getSession(c.req.param("id")))
    } catch (err) {
      logger.warn({ err, repoId }, "opencode unavailable for getSession, falling back to DB")
    }
  }
  const session = await getSessionFromDB(c.req.param("id"))
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

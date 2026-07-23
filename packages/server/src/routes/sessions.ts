import { Hono } from "hono"
import { processManager } from "../lib/process-manager"
import { DEFAULT_VARIANT } from "../lib/config"
import { syncSessionsList, syncMessagesList } from "../db/sync"
import type { SessionStatus } from "../lib/opencode"

export const sessions = new Hono()

// Create a session and immediately send the opening message (fire-and-forget).
sessions.post("/", async (c) => {
  const repoId = c.req.param("repoId")
  const client = processManager.requireClient(repoId)
  const body = await c.req.json<{ message?: string; agent?: string; model?: string; variant?: string; title?: string }>().catch(() => null)
  if (!body || typeof body.message !== "string" || body.message.length === 0) {
    return c.json({ error: "Body must include a non-empty 'message' string", status: 400 }, 400)
  }
  const session = await client.createSession({ agent: body.agent, title: body.title })
  await client.prompt(session.id, body.message, { agent: body.agent, model: body.model, variant: body.variant ?? DEFAULT_VARIANT })
  return c.json({ ...session, agent: body.agent }, 201)
})

sessions.get("/", async (c) => {
  const client = processManager.requireClient(c.req.param("repoId"))
  const list = await client.listSessions()
  syncSessionsList(list)
  return c.json(list)
})

sessions.get("/:id", async (c) => {
  const client = processManager.requireClient(c.req.param("repoId"))
  return c.json(await client.getSession(c.req.param("id")))
})

sessions.delete("/:id", async (c) => {
  const client = processManager.requireClient(c.req.param("repoId"))
  await client.deleteSession(c.req.param("id"))
  return c.json({ ok: true })
})

// Send a follow-up message to an existing session.
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
  const client = processManager.requireClient(c.req.param("repoId"))
  const id = c.req.param("id")
  const msgs = await client.getMessages(id)
  syncMessagesList(id, msgs)
  return c.json(msgs)
})

sessions.get("/:id/todos", async (c) => {
  const client = processManager.requireClient(c.req.param("repoId"))
  return c.json(await client.getTodos(c.req.param("id")))
})

// OpenCode reports status keyed by session id; absent means idle.
sessions.get("/:id/status", async (c) => {
  const client = processManager.requireClient(c.req.param("repoId"))
  const all = await client.getSessionStatus()
  const status: SessionStatus = all[c.req.param("id")] ?? { type: "idle" }
  return c.json(status)
})

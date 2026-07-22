import { Hono } from "hono"
import { opencode, type SessionStatus } from "../lib/opencode"
import { WORKSPACE_DIR, DEFAULT_VARIANT } from "../lib/config"

export const sessions = new Hono()

// Create a session and immediately send the opening message (fire-and-forget).
sessions.post("/", async (c) => {
  const body = await c.req.json<{ message?: string; agent?: string; model?: string; variant?: string; title?: string }>().catch(() => null)
  if (!body || typeof body.message !== "string" || body.message.length === 0) {
    return c.json({ error: "Body must include a non-empty 'message' string", status: 400 }, 400)
  }
  const session = await opencode.createSession(WORKSPACE_DIR, { agent: body.agent, title: body.title })
  await opencode.prompt(session.id, WORKSPACE_DIR, body.message, { agent: body.agent, model: body.model, variant: body.variant ?? DEFAULT_VARIANT })
  return c.json({ id: session.id, title: session.title, agent: body.agent }, 201)
})

sessions.get("/", async (c) => {
  return c.json(await opencode.listSessions(WORKSPACE_DIR))
})

sessions.get("/:id", async (c) => {
  return c.json(await opencode.getSession(c.req.param("id")))
})

sessions.delete("/:id", async (c) => {
  await opencode.deleteSession(c.req.param("id"))
  return c.json({ ok: true })
})

// Send a follow-up message to an existing session.
sessions.post("/:id/prompt", async (c) => {
  const body = await c.req.json<{ content?: string; agent?: string; model?: string; variant?: string }>().catch(() => null)
  if (!body || typeof body.content !== "string" || body.content.length === 0) {
    return c.json({ error: "Body must include a non-empty 'content' string", status: 400 }, 400)
  }
  await opencode.prompt(c.req.param("id"), WORKSPACE_DIR, body.content, { agent: body.agent, model: body.model, variant: body.variant ?? DEFAULT_VARIANT })
  return c.json({ ok: true })
})

sessions.post("/:id/abort", async (c) => {
  await opencode.abort(c.req.param("id"))
  return c.json({ ok: true })
})

sessions.get("/:id/messages", async (c) => {
  return c.json(await opencode.getMessages(c.req.param("id"), WORKSPACE_DIR))
})

sessions.get("/:id/todos", async (c) => {
  return c.json(await opencode.getTodos(c.req.param("id"), WORKSPACE_DIR))
})

// OpenCode reports status keyed by session id; absent means idle.
sessions.get("/:id/status", async (c) => {
  const all = await opencode.getSessionStatus(WORKSPACE_DIR)
  const status: SessionStatus = all[c.req.param("id")] ?? { type: "idle" }
  return c.json(status)
})

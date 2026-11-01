import { Hono } from "hono"
import { listBaseAgents } from "../lib/base-agents"

export const baseAgents = new Hono()

// GET /api/base-agents — built-in base agents plus local OpenCode custom agents.
baseAgents.get("/", async (c) => {
  return c.json(await listBaseAgents())
})

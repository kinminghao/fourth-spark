import { Hono } from "hono"
import { opencode } from "../lib/opencode"

export const agents = new Hono()

// GET /api/agents — list agents available in the workspace.
agents.get("/", async (c) => {
  return c.json(await opencode.listAgents())
})

import { Hono } from "hono"
import { processManager } from "../lib/process-manager"

export const agents = new Hono()

// GET /api/repos/:repoId/agents — list agents available in the workspace.
agents.get("/", async (c) => {
  const client = processManager.requireClient(c.req.param("repoId"))
  return c.json(await client.listAgents())
})

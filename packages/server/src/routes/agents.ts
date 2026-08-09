import { Hono } from "hono"
import { runtimeManager } from "../lib/process-manager"

export const agents = new Hono()

// GET /api/repos/:repoId/agents — list agents available in the workspace.
agents.get("/", async (c) => {
  const client = runtimeManager.requireClient(c.req.param("repoId"))
  return c.json(await client.listAgents())
})

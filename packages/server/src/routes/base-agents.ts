import { Hono } from "hono"
import {
  BaseAgentPresetNotFoundError,
  installBaseAgentPreset,
  listBaseAgentPresetInfos,
} from "../lib/base-agent-presets"
import { listBaseAgents } from "../lib/base-agents"

export const baseAgents = new Hono()

// GET /api/base-agents — built-in base agents plus local OpenCode custom agents.
baseAgents.get("/", async (c) => {
  return c.json(await listBaseAgents())
})

// GET /api/base-agents/presets — installable built-in base agent presets.
baseAgents.get("/presets", async (c) => {
  return c.json(await listBaseAgentPresetInfos())
})

// POST /api/base-agents/presets/:id/install — write a preset into the local
// OpenCode agents directory. Existing files are never overwritten.
baseAgents.post("/presets/:id/install", async (c) => {
  try {
    return c.json(await installBaseAgentPreset(c.req.param("id")))
  } catch (err) {
    if (err instanceof BaseAgentPresetNotFoundError) {
      return c.json({ error: err.message }, 404)
    }
    return c.json({ error: err instanceof Error ? err.message : "Failed to install base agent preset" }, 500)
  }
})

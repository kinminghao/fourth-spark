import { Hono } from "hono"
import { createMcpHandler } from "@modelcontextprotocol/server"
import { buildGitMcpServer } from "../mcp/git-tools"

// ---------------------------------------------------------------------------
// Per-repo MCP handler cache — each repoId gets its own handler (the factory
// inside is still called per-request, so the handler itself is stateless).
// ---------------------------------------------------------------------------

const handlers = new Map<string, ReturnType<typeof createMcpHandler>>()

function getHandler(repoId: string) {
  let h = handlers.get(repoId)
  if (!h) {
    h = createMcpHandler(() => buildGitMcpServer(repoId))
    handlers.set(repoId, h)
  }
  return h
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const mcpRoute = new Hono()

mcpRoute.all("/", async (c) => {
  const repoId = c.req.param("repoId")
  if (!repoId) return c.json({ error: "Missing repoId" }, 400)
  const handler = getHandler(repoId)
  return handler.fetch(c.req.raw)
})

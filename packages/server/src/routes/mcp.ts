import { Hono } from "hono"
import { createMcpHandler } from "@modelcontextprotocol/server"
import { buildGitMcpServer } from "../mcp/git-tools"

// ---------------------------------------------------------------------------
// MCP handler cache — keyed by "repoId" or "repoId:sessionId". Each unique
// key gets its own handler whose factory creates an MCP server that knows the
// calling session (when available).
// ---------------------------------------------------------------------------

const handlers = new Map<string, ReturnType<typeof createMcpHandler>>()

function getHandler(repoId: string, sessionId?: string) {
  const key = sessionId ? `${repoId}:${sessionId}` : repoId
  let h = handlers.get(key)
  if (!h) {
    h = createMcpHandler(() => buildGitMcpServer(repoId, sessionId))
    handlers.set(key, h)
  }
  return h
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const mcpRoute = new Hono()

// Session-specific endpoint — deterministic session identity from URL.
// URL: /api/repos/:repoId/mcp/s/:sessionId
mcpRoute.all("/s/:sessionId", async (c) => {
  const repoId = c.req.param("repoId")
  const sessionId = c.req.param("sessionId")
  if (!repoId) return c.json({ error: "Missing repoId" }, 400)
  if (!sessionId) return c.json({ error: "Missing sessionId" }, 400)
  const handler = getHandler(repoId, sessionId)
  return handler.fetch(c.req.raw)
})

// Repo-level endpoint — backward compatible, falls back to heuristic resolution.
mcpRoute.all("/", async (c) => {
  const repoId = c.req.param("repoId")
  if (!repoId) return c.json({ error: "Missing repoId" }, 400)
  const handler = getHandler(repoId)
  return handler.fetch(c.req.raw)
})

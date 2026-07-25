import { Hono } from "hono"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { repos } from "../db/schema"

async function safeRead(path: string): Promise<string> {
  try { return await readFile(path, "utf-8") }
  catch { return "" }
}

async function safeWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf-8")
}

const GLOBAL_PATH = join(homedir(), ".config", "opencode", "AGENTS.md")

// ---------------------------------------------------------------------------
// Global AGENTS.md — mount at /api/agents-md
// ---------------------------------------------------------------------------
export const globalAgentsMd = new Hono()

globalAgentsMd.get("/", async (c) => {
  return c.json({ content: await safeRead(GLOBAL_PATH) })
})

globalAgentsMd.put("/", async (c) => {
  const body = await c.req.json<{ content?: string }>().catch(() => null)
  if (!body || typeof body.content !== "string") {
    return c.json({ error: "body must include a string 'content'" }, 400)
  }
  await safeWrite(GLOBAL_PATH, body.content)
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Repo-scoped AGENTS.md — mount at /api/repos
// ---------------------------------------------------------------------------
export const repoAgentsMd = new Hono()

repoAgentsMd.get("/:id/agents-md", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found", status: 404 }, 404)
  return c.json({ content: await safeRead(join(repo.localPath, "AGENTS.md")) })
})

repoAgentsMd.put("/:id/agents-md", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found", status: 404 }, 404)
  const body = await c.req.json<{ content?: string }>().catch(() => null)
  if (!body || typeof body.content !== "string") {
    return c.json({ error: "body must include a string 'content'" }, 400)
  }
  await writeFile(join(repo.localPath, "AGENTS.md"), body.content, "utf-8")
  return c.json({ ok: true })
})

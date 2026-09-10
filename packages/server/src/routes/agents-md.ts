import { Hono } from "hono"
import { z } from "zod"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { repos } from "../db/schema"
import { parseBody } from "../lib/validation"

async function safeRead(path: string): Promise<string> {
  try { return await readFile(path, "utf-8") }
  catch { return "" }
}

async function safeWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf-8")
}

const UpdateGlobalAgentsMdBody = z.object({
  content: z.string(),
  runtimeType: z.string().optional(),
})

const UpdateRepoAgentsMdBody = z.object({
  content: z.string(),
})

const INSTRUCTION_FILES: Record<string, { fileName: string; globalDir: string }> = {
  opencode: { fileName: "AGENTS.md", globalDir: join(homedir(), ".config", "opencode") },
  "claude-code": { fileName: "CLAUDE.md", globalDir: join(homedir(), ".claude") },
}

function instructionConfig(runtimeType?: string | null) {
  return INSTRUCTION_FILES[runtimeType ?? "opencode"] ?? INSTRUCTION_FILES.opencode
}

export function instructionFileName(runtimeType?: string | null): string {
  return instructionConfig(runtimeType).fileName
}

const DEFAULT_GLOBAL_PATH = join(homedir(), ".config", "opencode", "AGENTS.md")

// ---------------------------------------------------------------------------
// Global AGENTS.md — mount at /api/agents-md
// ---------------------------------------------------------------------------
export const globalAgentsMd = new Hono()

globalAgentsMd.get("/", async (c) => {
  const rt = c.req.query("runtimeType")
  const globalPath = rt ? join(instructionConfig(rt).globalDir, instructionConfig(rt).fileName) : DEFAULT_GLOBAL_PATH
  return c.json({ content: await safeRead(globalPath) })
})

globalAgentsMd.put("/", async (c) => {
  const [body, err] = await parseBody(c, UpdateGlobalAgentsMdBody)
  if (err) return err
  const cfg = instructionConfig(body.runtimeType)
  await safeWrite(join(cfg.globalDir, cfg.fileName), body.content)
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Repo-scoped instruction file — mount at /api/repos
// ---------------------------------------------------------------------------
export const repoAgentsMd = new Hono()

repoAgentsMd.get("/:id/agents-md", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found" }, 404)
  const fileName = instructionFileName(repo.runtimeType)
  return c.json({ content: await safeRead(join(repo.localPath, fileName)) })
})

repoAgentsMd.put("/:id/agents-md", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found" }, 404)
  const [body, err] = await parseBody(c, UpdateRepoAgentsMdBody)
  if (err) return err
  const fileName = instructionFileName(repo.runtimeType)
  await writeFile(join(repo.localPath, fileName), body.content, "utf-8")
  return c.json({ ok: true })
})

import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { basename } from "node:path"
import { db } from "../db/index"
import { repos } from "../db/schema"
import { processManager } from "../lib/process-manager"
import { existsSync } from "node:fs"

export const repoRoutes = new Hono()

function getBranch(localPath: string): string | null {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: localPath })
    const branch = result.stdout.toString().trim()
    return branch || null
  } catch {
    return null
  }
}

// POST /api/repos/resolve — read .git directory to extract repo name and remote URL.
repoRoutes.post("/resolve", async (c) => {
  const body = await c.req.json<{ localPath?: string }>().catch(() => null)
  if (!body?.localPath) {
    return c.json({ error: "localPath is required", status: 400 }, 400)
  }

  const localPath = body.localPath.replace(/\/+$/, "")

  if (!existsSync(localPath)) {
    return c.json({ error: "路径不存在", status: 400 }, 400)
  }

  if (!existsSync(`${localPath}/.git`)) {
    return c.json({ error: "该目录不是 Git 仓库", status: 400 }, 400)
  }

  const name = basename(localPath)

  let gitUrl = ""
  try {
    const result = Bun.spawnSync(["git", "config", "--get", "remote.origin.url"], { cwd: localPath })
    gitUrl = result.stdout.toString().trim()
  } catch {}

  return c.json({ name, gitUrl, localPath })
})

// POST /api/repos — register a new repo and start its opencode process.
repoRoutes.post("/", async (c) => {
  const body = await c.req.json<{ name?: string; gitUrl?: string; localPath?: string }>().catch(() => null)
  if (!body || !body.name || !body.gitUrl || !body.localPath) {
    return c.json({ error: "Body must include name, gitUrl, and localPath", status: 400 }, 400)
  }

  if (!existsSync(body.localPath)) {
    return c.json({ error: `Local path does not exist: ${body.localPath}`, status: 400 }, 400)
  }

  const id = crypto.randomUUID()
  const now = Date.now()

  try {
    await db.insert(repos).values({
      id,
      name: body.name,
      gitUrl: body.gitUrl,
      localPath: body.localPath,
      status: "inactive",
      createdAt: now,
      updatedAt: now,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return c.json({ error: "A repo with this local path already exists", status: 409 }, 409)
    }
    throw err
  }

  // Start the opencode process for this repo.
  try {
    await processManager.start(id, body.localPath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start opencode"
    return c.json({ id, name: body.name, status: "error", error: msg }, 201)
  }

  const [repo] = await db.select().from(repos).where(eq(repos.id, id))
  return c.json(repo, 201)
})

// GET /api/repos — list all repos.
repoRoutes.get("/", async (c) => {
  const all = await db.select().from(repos)
  // Augment with live running status.
  const result = all.map((r) => ({
    ...r,
    running: processManager.isRunning(r.id),
    branch: getBranch(r.localPath),
  }))
  return c.json(result)
})

// GET /api/repos/:id — get a single repo.
repoRoutes.get("/:id", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found", status: 404 }, 404)
  return c.json({ ...repo, running: processManager.isRunning(repo.id), branch: getBranch(repo.localPath) })
})

// DELETE /api/repos/:id — stop the opencode process and remove the repo.
repoRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id")
  await processManager.stop(id)
  await db.delete(repos).where(eq(repos.id, id))
  return c.json({ ok: true })
})

// POST /api/repos/:id/start — manually start a stopped repo.
repoRoutes.post("/:id/start", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found", status: 404 }, 404)
  try {
    await processManager.start(repo.id, repo.localPath)
    return c.json({ ok: true, status: "active" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start"
    return c.json({ error: msg, status: 500 }, 500)
  }
})

// POST /api/repos/:id/stop — manually stop a running repo.
repoRoutes.post("/:id/stop", async (c) => {
  await processManager.stop(c.req.param("id"))
  return c.json({ ok: true, status: "inactive" })
})

// GET /api/repos/:id/branches — list all branches.
repoRoutes.get("/:id/branches", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found", status: 404 }, 404)

  const current = getBranch(repo.localPath)

  try {
    const result = Bun.spawnSync(["git", "branch", "--format=%(refname:short)"], { cwd: repo.localPath })
    const output = result.stdout.toString().trim()
    const local = output ? output.split("\n").map((b) => b.trim()).filter(Boolean) : []

    const remoteResult = Bun.spawnSync(["git", "branch", "-r", "--format=%(refname:short)"], { cwd: repo.localPath })
    const remoteOutput = remoteResult.stdout.toString().trim()
    const remote = remoteOutput
      ? remoteOutput
          .split("\n")
          .map((b) => b.trim())
          .filter((b) => b && !b.includes("->"))
          .map((b) => b.replace(/^origin\//, ""))
          .filter((b) => !local.includes(b))
      : []

    return c.json({ current, local, remote })
  } catch {
    return c.json({ current, local: current ? [current] : [], remote: [] })
  }
})

// POST /api/repos/:id/checkout — switch branch.
repoRoutes.post("/:id/checkout", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found", status: 404 }, 404)

  const body = await c.req.json<{ branch?: string }>().catch(() => null)
  if (!body?.branch) {
    return c.json({ error: "branch is required", status: 400 }, 400)
  }

  try {
    const result = Bun.spawnSync(["git", "checkout", body.branch], { cwd: repo.localPath })
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim()
      return c.json({ error: stderr || "Failed to checkout branch", status: 400 }, 400)
    }
    const branch = getBranch(repo.localPath)
    return c.json({ ok: true, branch })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to checkout"
    return c.json({ error: msg, status: 500 }, 500)
  }
})

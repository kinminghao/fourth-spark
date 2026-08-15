import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { basename } from "node:path"
import { db } from "../db/index"
import { repos } from "../db/schema"
import { runtimeManager } from "../lib/process-manager"
import { existsSync } from "node:fs"
import { runGit, runGitWithRetry, withRepoLock, cleanupStaleLock, pruneRemoteRefs, classifyGitError } from "../lib/git-runner"

export const repoRoutes = new Hono()

function getBranch(localPath: string): string | null {
  const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"], localPath, { timeout: 5_000 })
  return result.ok ? (result.stdout || null) : null
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
  const result = runGit(["config", "--get", "remote.origin.url"], localPath, { timeout: 5_000 })
  if (result.ok) gitUrl = result.stdout

  return c.json({ name, gitUrl, localPath })
})

// POST /api/repos — register a new repo and start its runtime.
repoRoutes.post("/", async (c) => {
  const body = await c.req.json<{ name?: string; gitUrl?: string; localPath?: string; runtimeType?: string }>().catch(() => null)
  if (!body || !body.name || !body.gitUrl || !body.localPath) {
    return c.json({ error: "Body must include name, gitUrl, and localPath", status: 400 }, 400)
  }

  if (!existsSync(body.localPath)) {
    return c.json({ error: `Local path does not exist: ${body.localPath}`, status: 400 }, 400)
  }

  const runtimeType = body.runtimeType ?? "opencode"
  const id = crypto.randomUUID()
  const now = Date.now()

  try {
    await db.insert(repos).values({
      id,
      name: body.name,
      gitUrl: body.gitUrl,
      localPath: body.localPath,
      runtimeType,
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

  try {
    await runtimeManager.start(id, body.localPath, runtimeType)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start runtime"
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
    worktreeEnabled: Boolean(r.worktreeEnabled),
    running: runtimeManager.isRunning(r.id),
    branch: getBranch(r.localPath),
  }))
  return c.json(result)
})

// GET /api/repos/:id — get a single repo.
repoRoutes.get("/:id", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found", status: 404 }, 404)
  return c.json({ ...repo, worktreeEnabled: Boolean(repo.worktreeEnabled), running: runtimeManager.isRunning(repo.id), branch: getBranch(repo.localPath) })
})

// DELETE /api/repos/:id — stop the opencode process and remove the repo.
repoRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id")
  await runtimeManager.stop(id)
  await db.delete(repos).where(eq(repos.id, id))
  return c.json({ ok: true })
})

// POST /api/repos/:id/start — manually start a stopped repo.
repoRoutes.post("/:id/start", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found", status: 404 }, 404)
  try {
    await runtimeManager.start(repo.id, repo.localPath, repo.runtimeType ?? undefined)
    return c.json({ ok: true, status: "active" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start"
    return c.json({ error: msg, status: 500 }, 500)
  }
})

// POST /api/repos/:id/stop — manually stop a running repo.
repoRoutes.post("/:id/stop", async (c) => {
  await runtimeManager.stop(c.req.param("id"))
  return c.json({ ok: true, status: "inactive" })
})

// GET /api/repos/:id/branches — list all branches.
repoRoutes.get("/:id/branches", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found", status: 404 }, 404)

  const current = getBranch(repo.localPath)

  const result = runGit(["branch", "--format=%(refname:short)"], repo.localPath)
  const local = result.ok && result.stdout
    ? result.stdout.split("\n").map((b) => b.trim()).filter(Boolean)
    : current ? [current] : []

  const remoteResult = runGit(["branch", "-r", "--format=%(refname:short)"], repo.localPath)
  const remote = remoteResult.ok && remoteResult.stdout
    ? remoteResult.stdout
        .split("\n")
        .map((b) => b.trim())
        .filter((b) => b && !b.includes("->"))
        .map((b) => b.replace(/^origin\//, ""))
        .filter((b) => !local.includes(b))
    : []

  return c.json({ current, local, remote })
})

// POST /api/repos/:id/checkout — switch branch.
repoRoutes.post("/:id/checkout", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found", status: 404 }, 404)

  const body = await c.req.json<{ branch?: string }>().catch(() => null)
  if (!body?.branch) {
    return c.json({ error: "branch is required", status: 400 }, 400)
  }
  const targetBranch = body.branch

  return await withRepoLock(repo.localPath, () => {
    // Stash uncommitted changes before checkout (matching pull's --autostash behavior)
    const stashResult = runGit(["stash", "--include-untracked"], repo.localPath)
    const didStash = stashResult.ok && !stashResult.stdout.includes("No local changes")

    const result = runGit(["checkout", targetBranch], repo.localPath)

    if (!result.ok) {
      // Restore stash if checkout failed
      if (didStash) runGit(["stash", "pop"], repo.localPath)
      const errorInfo = classifyGitError(result.stdout, result.stderr)
      return c.json({ error: errorInfo.message, code: errorInfo.code, status: 400 }, 400)
    }

    // Pop stash after successful checkout
    if (didStash) {
      const popResult = runGit(["stash", "pop"], repo.localPath)
      if (!popResult.ok) {
        // Stash pop conflict — leave stash, warn user
        return c.json({
          ok: true,
          branch: getBranch(repo.localPath),
          warning: "分支切换成功，但暂存的修改恢复时有冲突，请手动执行 git stash pop 解决",
        })
      }
    }

    return c.json({ ok: true, branch: getBranch(repo.localPath) })
  })
})

// POST /api/repos/:id/pull — pull latest code from remote.
repoRoutes.post("/:id/pull", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found", status: 404 }, 404)

  return await withRepoLock(repo.localPath, async () => {
    // Pre-pull cleanup: remove stale lock files and prune remote refs
    cleanupStaleLock(repo.localPath)
    pruneRemoteRefs(repo.localPath)

    const result = await runGitWithRetry(["pull", "--ff-only", "--autostash"], repo.localPath)

    if (!result.ok) {
      const errorInfo = classifyGitError(result.stdout, result.stderr)
      return c.json({ error: errorInfo.message, code: errorInfo.code, status: 500 }, 500)
    }

    return c.json({ ok: true, output: result.stdout, branch: getBranch(repo.localPath) })
  })
})

repoRoutes.patch("/:id/runtime", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{ runtimeType: string }>().catch(() => null)
  if (!body?.runtimeType || typeof body.runtimeType !== "string") {
    return c.json({ error: "'runtimeType' string is required" }, 400)
  }
  const [repo] = await db.select().from(repos).where(eq(repos.id, id))
  if (!repo) return c.json({ error: "Repo not found", status: 404 }, 404)

  if (repo.runtimeType === body.runtimeType) {
    return c.json({ ok: true, runtimeType: body.runtimeType })
  }

  const wasRunning = runtimeManager.isRunning(id)
  if (wasRunning) await runtimeManager.stop(id)
  await db.update(repos).set({ runtimeType: body.runtimeType, updatedAt: Date.now() }).where(eq(repos.id, id))
  if (wasRunning) {
    await runtimeManager.start(id, repo.localPath, body.runtimeType)
  }
  return c.json({ ok: true, runtimeType: body.runtimeType })
})

repoRoutes.patch("/:id/worktree", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{ enabled: boolean }>().catch(() => null)
  if (!body || typeof body.enabled !== "boolean") {
    return c.json({ error: "'enabled' boolean is required" }, 400)
  }
  await db.update(repos).set({ worktreeEnabled: body.enabled ? 1 : 0, updatedAt: Date.now() }).where(eq(repos.id, id))
  return c.json({ ok: true, worktreeEnabled: body.enabled })
})

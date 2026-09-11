import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { basename, resolve, join } from "node:path"
import { z } from "zod"
import { db } from "../db/index"
import { repos } from "../db/schema"
import { runtimeManager } from "../lib/process-manager"
import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { runGit, runGitWithRetry, withRepoLock, cleanupStaleLock, pruneRemoteRefs, classifyGitError, isValidGitBranchName } from "../lib/git-runner"
import { parseGitUrl, normalizeGitUrl } from "../lib/git-url"
import { parseBody } from "../lib/validation"

const ResolveRepoBody = z.object({
  localPath: z.string().min(1),
})
const CloneRepoBody = z.object({
  gitUrl: z.string().min(1),
  targetDir: z.string().optional(),
})
const CreateRepoBody = z.object({
  name: z.string().min(1),
  gitUrl: z.string().min(1),
  localPath: z.string().min(1),
  runtimeType: z.string().optional(),
})
const CheckoutBody = z.object({
  branch: z.string().min(1),
})
const UpdateRuntimeBody = z.object({
  runtimeType: z.string().min(1),
})
const UpdateWorktreeBody = z.object({
  enabled: z.boolean(),
})

export const repoRoutes = new Hono()

function getBranch(localPath: string): string | null {
  const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"], localPath, { timeout: 5_000 })
  return result.ok ? (result.stdout || null) : null
}

// POST /api/repos/resolve — read .git directory to extract repo name and remote URL.
repoRoutes.post("/resolve", async (c) => {
  const [body, err] = await parseBody(c, ResolveRepoBody)
  if (err) return err

  const localPath = body.localPath.replace(/\/+$/, "")

  if (!existsSync(localPath)) {
    return c.json({ error: "路径不存在" }, 400)
  }

  if (!existsSync(`${localPath}/.git`)) {
    return c.json({ error: "该目录不是 Git 仓库" }, 400)
  }

  const name = basename(localPath)

  let gitUrl = ""
  const result = runGit(["config", "--get", "remote.origin.url"], localPath, { timeout: 5_000 })
  if (result.ok) gitUrl = normalizeGitUrl(result.stdout)

  return c.json({ name, gitUrl, localPath })
})

// POST /api/repos/clone — clone a git repo to a local directory.
repoRoutes.post("/clone", async (c) => {
  const [body, err] = await parseBody(c, CloneRepoBody)
  if (err) return err

  const gitUrl = body.gitUrl.trim()

  const parsed = parseGitUrl(gitUrl)
  const repoName = parsed?.repo ?? (basename(gitUrl).replace(/\.git$/, "") || "repo")

  const defaultBase = join(homedir(), ".fourth-spark", "repos")
  const targetDir = body.targetDir?.trim()
    ? resolve(body.targetDir.trim())
    : join(defaultBase, repoName)

  if (body.targetDir?.includes("..")) {
    return c.json({ error: "目标路径不允许包含 '..'" }, 400)
  }

  if (existsSync(targetDir)) {
    return c.json({ error: `目标目录已存在: ${targetDir}` }, 409)
  }

  const parentDir = resolve(targetDir, "..")
  try {
    mkdirSync(parentDir, { recursive: true })
  } catch {
    return c.json({ error: `无法创建父目录: ${parentDir}` }, 500)
  }

  const result = await runGitWithRetry(
    ["clone", "--", gitUrl, targetDir],
    parentDir,
    { timeout: 300_000 },
  )

  if (!result.ok) {
    const errorInfo = classifyGitError(result.stdout, result.stderr)
    return c.json({ error: errorInfo.message, code: errorInfo.code }, 500)
  }

  let clonedGitUrl = normalizeGitUrl(gitUrl)
  const remoteResult = runGit(["config", "--get", "remote.origin.url"], targetDir, { timeout: 5_000 })
  if (remoteResult.ok && remoteResult.stdout) clonedGitUrl = normalizeGitUrl(remoteResult.stdout)

  return c.json({ localPath: targetDir, name: repoName, gitUrl: clonedGitUrl })
})

// POST /api/repos — register a new repo and start its runtime.
repoRoutes.post("/", async (c) => {
  const [body, err] = await parseBody(c, CreateRepoBody)
  if (err) return err

  if (!existsSync(body.localPath)) {
    return c.json({ error: `Local path does not exist: ${body.localPath}` }, 400)
  }

  const runtimeType = body.runtimeType ?? "opencode"

  const [existing] = await db.select({ id: repos.id, name: repos.name }).from(repos).where(eq(repos.localPath, body.localPath))
  if (existing) {
    return c.json({ error: `Local path already registered as repo "${existing.name}". Delete it first before re-adding.` }, 409)
  }

  const id = crypto.randomUUID()
  const now = Date.now()

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
  if (!repo) return c.json({ error: "Repo not found" }, 404)
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
  if (!repo) return c.json({ error: "Repo not found" }, 404)
  try {
    await runtimeManager.start(repo.id, repo.localPath, repo.runtimeType ?? undefined)
    return c.json({ status: "active" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start"
    return c.json({ error: msg }, 500)
  }
})

// POST /api/repos/:id/stop — manually stop a running repo.
repoRoutes.post("/:id/stop", async (c) => {
  await runtimeManager.stop(c.req.param("id"))
  return c.json({ status: "inactive" })
})

// GET /api/repos/:id/branches — list all branches.
repoRoutes.get("/:id/branches", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found" }, 404)

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
  if (!repo) return c.json({ error: "Repo not found" }, 404)

  const [body, err] = await parseBody(c, CheckoutBody)
  if (err) return err
  const targetBranch = body.branch
  if (!isValidGitBranchName(targetBranch)) {
    return c.json({ error: "Invalid branch name" }, 400)
  }

  return await withRepoLock(repo.localPath, () => {
    // Stash uncommitted changes before checkout (matching pull's --autostash behavior)
    const stashResult = runGit(["stash", "--include-untracked"], repo.localPath)
    const didStash = stashResult.ok && !stashResult.stdout.includes("No local changes")

    const result = runGit(["checkout", "--", targetBranch], repo.localPath)

    if (!result.ok) {
      // Restore stash if checkout failed
      if (didStash) runGit(["stash", "pop"], repo.localPath)
      const errorInfo = classifyGitError(result.stdout, result.stderr)
      return c.json({ error: errorInfo.message, code: errorInfo.code }, 400)
    }

    // Pop stash after successful checkout
    if (didStash) {
      const popResult = runGit(["stash", "pop"], repo.localPath)
      if (!popResult.ok) {
        // Stash pop conflict — leave stash, warn user
        return c.json({
          branch: getBranch(repo.localPath),
          warning: "分支切换成功，但暂存的修改恢复时有冲突，请手动执行 git stash pop 解决",
        })
      }
    }

    return c.json({ branch: getBranch(repo.localPath) })
  })
})

// POST /api/repos/:id/pull — pull latest code from remote.
repoRoutes.post("/:id/pull", async (c) => {
  const [repo] = await db.select().from(repos).where(eq(repos.id, c.req.param("id")))
  if (!repo) return c.json({ error: "Repo not found" }, 404)

  return await withRepoLock(repo.localPath, async () => {
    // Pre-pull cleanup: remove stale lock files and prune remote refs
    cleanupStaleLock(repo.localPath)
    pruneRemoteRefs(repo.localPath)

    const result = await runGitWithRetry(["pull", "--ff-only", "--autostash"], repo.localPath)

    if (!result.ok) {
      const errorInfo = classifyGitError(result.stdout, result.stderr)
      return c.json({ error: errorInfo.message, code: errorInfo.code }, 500)
    }

    const alreadyUpToDate = /already up.to.date/i.test(result.stdout)
    const autostashed = /autostash/i.test(result.stderr)
    const filesChangedMatch = result.stdout.match(/(\d+)\s+files?\s+changed/)
    const filesChanged = filesChangedMatch ? Number(filesChangedMatch[1]) : 0

    let summary: string
    if (alreadyUpToDate) {
      summary = "已是最新，无需更新"
    } else if (filesChanged > 0) {
      summary = `已更新 ${filesChanged} 个文件`
    } else {
      summary = "拉取完成"
    }
    if (autostashed) {
      summary += "（已自动暂存并恢复本地修改）"
    }

    return c.json({ output: result.stdout, branch: getBranch(repo.localPath), summary, alreadyUpToDate, autostashed, filesChanged })
  })
})

repoRoutes.patch("/:id/runtime", async (c) => {
  const id = c.req.param("id")
  const [body, err] = await parseBody(c, UpdateRuntimeBody)
  if (err) return err
  const [repo] = await db.select().from(repos).where(eq(repos.id, id))
  if (!repo) return c.json({ error: "Repo not found" }, 404)

  if (repo.runtimeType === body.runtimeType) {
    return c.json({ runtimeType: body.runtimeType })
  }

  const wasRunning = runtimeManager.isRunning(id)
  if (wasRunning) await runtimeManager.stop(id)
  await db.update(repos).set({ runtimeType: body.runtimeType, updatedAt: Date.now() }).where(eq(repos.id, id))
  if (wasRunning) {
    await runtimeManager.start(id, repo.localPath, body.runtimeType)
  }
  return c.json({ runtimeType: body.runtimeType })
})

repoRoutes.patch("/:id/worktree", async (c) => {
  const id = c.req.param("id")
  const [body, err] = await parseBody(c, UpdateWorktreeBody)
  if (err) return err
  await db.update(repos).set({ worktreeEnabled: body.enabled ? 1 : 0, updatedAt: Date.now() }).where(eq(repos.id, id))
  return c.json({ worktreeEnabled: body.enabled })
})

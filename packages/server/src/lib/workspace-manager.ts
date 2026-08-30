import { eq } from "drizzle-orm"
import { existsSync, mkdirSync, symlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { db } from "../db/index"
import { repos, workspaces } from "../db/schema"
import { logger } from "../middleware/logger"
import { runGit } from "./git-runner"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKTREE_DIR = join(homedir(), ".fourth-spark", "worktrees")
const SHORT_ID_LENGTH = 8

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Workspace = typeof workspaces.$inferSelect

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, SHORT_ID_LENGTH)
}

function symlinkInstructionFileIfMissing(repoLocalPath: string, worktreePath: string, fileName: string): void {
  const source = join(repoLocalPath, fileName)
  const target = join(worktreePath, fileName)
  if (!existsSync(source)) return
  if (existsSync(target)) return
  try {
    symlinkSync(source, target)
    logger.info({ source, target }, `symlinked ${fileName} into worktree`)
  } catch (err) {
    logger.warn({ err, source, target }, `failed to symlink ${fileName}`)
  }
}

async function detectBaseBranch(repoLocalPath: string): Promise<string> {
  const current = runGit(["rev-parse", "--abbrev-ref", "HEAD"], repoLocalPath)
  if (current.ok) {
    const branch = current.stdout.trim()
    if (branch && branch !== "HEAD") return branch
  }
  return "main"
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const workspaceManager = {
  async create(repoId: string, repoLocalPath: string, baseBranch?: string, runtimeType?: string | null): Promise<Workspace> {
    mkdirSync(WORKTREE_DIR, { recursive: true })

    const id = crypto.randomUUID()
    const sid = shortId()
    const branch = `ws/${sid}`
    const localPath = join(WORKTREE_DIR, `${repoId}-${sid}`)
    const resolvedBase = baseBranch ?? await detectBaseBranch(repoLocalPath)

    const result = runGit(["worktree", "add", localPath, "-b", branch], repoLocalPath)
    if (!result.ok) {
      const msg = result.stderr.trim() || result.stdout.trim() || "git worktree add failed"
      logger.error({ repoId, repoLocalPath, localPath, branch, msg }, "worktree add failed")
      throw new Error(`Failed to create worktree: ${msg}`)
    }

    const { instructionFileName } = await import("../routes/agents-md")
    symlinkInstructionFileIfMissing(repoLocalPath, localPath, instructionFileName(runtimeType))

    const now = Date.now()
    const [row] = await db.insert(workspaces).values({
      id,
      repoId,
      branch,
      localPath,
      baseBranch: resolvedBase,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }).returning()

    logger.info({ workspaceId: id, repoId, branch, localPath }, "workspace created")
    return row
  },

  async remove(workspaceId: string): Promise<void> {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
    if (!ws) return

    // git worktree remove / branch delete must run from the main repo, not the worktree itself.
    const [repo] = await db.select({ localPath: repos.localPath })
      .from(repos).where(eq(repos.id, ws.repoId))
    const cwd = repo?.localPath ?? ws.localPath

    const removeResult = runGit(["worktree", "remove", "--force", ws.localPath], cwd)
    if (!removeResult.ok) {
      logger.warn({ workspaceId, stderr: removeResult.stderr.trim() }, "worktree remove failed, continuing")
    }

    const branchDelete = runGit(["branch", "-D", ws.branch], cwd)
    if (!branchDelete.ok) {
      logger.warn({ workspaceId, branch: ws.branch, stderr: branchDelete.stderr.trim() }, "branch delete failed, continuing")
    }

    await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
    logger.info({ workspaceId, repoId: ws.repoId, branch: ws.branch }, "workspace removed")
  },

  async get(workspaceId: string): Promise<Workspace | null> {
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
    return row ?? null
  },

  async listByRepo(repoId: string): Promise<Workspace[]> {
    return await db.select().from(workspaces).where(eq(workspaces.repoId, repoId))
  },

  async getDiskUsage(localPath: string): Promise<number> {
    if (!existsSync(localPath)) return 0
    try {
      const result = Bun.spawnSync(["du", "-sb", localPath])
      if (result.exitCode !== 0) return 0
      const output = result.stdout.toString().trim()
      const bytes = parseInt(output.split(/\s+/)[0] ?? "0", 10)
      return Number.isFinite(bytes) ? bytes : 0
    } catch {
      return 0
    }
  },

  async updateStatus(workspaceId: string, status: string): Promise<void> {
    await db.update(workspaces)
      .set({ status, updatedAt: Date.now() })
      .where(eq(workspaces.id, workspaceId))
  },

  async checkMerged(workspaceId: string): Promise<boolean> {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
    if (!ws) return false

    const [repo] = await db.select({ localPath: repos.localPath })
      .from(repos).where(eq(repos.id, ws.repoId))
    if (!repo) return false

    const result = runGit(["merge-base", "--is-ancestor", ws.branch, ws.baseBranch], repo.localPath)
    return result.ok
  },

  async getChangedFiles(workspaceId: string): Promise<string[]> {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
    if (!ws) return []
    if (!existsSync(ws.localPath)) return []

    const result = runGit(["diff", "--diff-filter=ACMRT", "--name-only", `${ws.baseBranch}...HEAD`], ws.localPath)
    if (!result.ok) {
      const fallback = runGit(["diff", "--diff-filter=ACMRT", "--name-only", ws.baseBranch], ws.localPath)
      if (!fallback.ok) {
        logger.warn({ workspaceId, stderr: fallback.stderr }, "git diff --name-only failed")
        return []
      }
      return fallback.stdout.split("\n").filter(Boolean)
    }
    return result.stdout.split("\n").filter(Boolean)
  },
}

export { WORKTREE_DIR }

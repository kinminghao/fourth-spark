import { eq } from "drizzle-orm"
import { db } from "../../db/index"
import { sessionLinks, sessions as sessionsTable, workspaces } from "../../db/schema"
import type { GitIssueClient } from "../../lib/git-provider"
import { getRepoGitClient } from "../../lib/git-utils"
import { runtimeManager } from "../../lib/process-manager"
import { logger } from "../../middleware/logger"

// Re-export shared helpers so tool files import from one place
export { issueToDb, commentToDb, prToDb } from "../../lib/git-utils"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function getClientForRepo(repoId: string) {
  const result = await getRepoGitClient(repoId)
  if (!result) throw new Error(`Failed to resolve git client for repo ${repoId}`)
  return result
}

export function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
}

export function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true }
}

/**
 * Resolve the session that initiated the MCP call. When `knownSessionId` is
 * provided (session-specific MCP endpoint), return it directly. Otherwise fall
 * back to runtime heuristic: return the session only when exactly ONE is busy.
 * Multiple busy sessions → return null to avoid mis-association (#539).
 */
export async function resolveSessionId(repoId: string, knownSessionId?: string): Promise<string | null> {
  if (knownSessionId) return knownSessionId

  try {
    const client = runtimeManager.getClient(repoId)
    if (!client) return null
    const statuses = await client.getSessionStatus()
    const busySessions = Object.entries(statuses)
      .filter(([_, status]) => status.type === "busy")

    if (busySessions.length === 1) return busySessions[0][0]

    if (busySessions.length > 1) {
      logger.warn({ repoId, count: busySessions.length },
        "multiple busy sessions — skipping auto-link to avoid mis-association")
    }
  } catch (err) {
    logger.warn({ err, repoId }, "failed to resolve session for auto-link")
  }
  return null
}

export async function renameWorkspaceBranch(repoId: string, head: string, knownSessionId?: string): Promise<void> {
  const sessionId = await resolveSessionId(repoId, knownSessionId)
  if (!sessionId) return

  const [session] = await db.select({ workspaceId: sessionsTable.workspaceId })
    .from(sessionsTable).where(eq(sessionsTable.id, sessionId))
  if (!session?.workspaceId) return

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId))
  if (!workspace || !workspace.branch.startsWith("ws/")) return
  if (workspace.branch === head) return

  const cwd = workspace.localPath

  const renameResult = Bun.spawnSync(["git", "branch", "-m", workspace.branch, head], { cwd })
  if (renameResult.exitCode !== 0) {
    const stderr = renameResult.stderr.toString().trim()
    logger.warn({ repoId, from: workspace.branch, to: head, stderr }, "MCP: branch rename failed, continuing with original name")
    return
  }

  const pushResult = Bun.spawnSync(["git", "push", "-u", "origin", head], { cwd })
  if (pushResult.exitCode !== 0) {
    const stderr = pushResult.stderr.toString().trim()
    logger.warn({ repoId, branch: head, stderr }, "MCP: push after rename failed")
  }

  await db.update(workspaces).set({ branch: head, updatedAt: Date.now() }).where(eq(workspaces.id, workspace.id))
  logger.info({ repoId, from: workspace.branch, to: head }, "MCP: renamed workspace branch for PR")
}

export async function linkSessionTarget(repoId: string, type: "issue" | "pr", targetId: string, knownSessionId?: string): Promise<void> {
  const sessionId = await resolveSessionId(repoId, knownSessionId)
  if (!sessionId) return
  try {
    await db.insert(sessionLinks).values({
      sessionId,
      type,
      targetId,
      createdAt: Date.now(),
    }).onConflictDoNothing()
    logger.info({ sessionId, type, targetId }, "auto-linked session to target")
  } catch (err) {
    logger.warn({ err, sessionId, type, targetId }, "failed to auto-link session")
  }
}

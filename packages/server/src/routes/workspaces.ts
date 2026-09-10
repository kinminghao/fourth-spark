import { Hono } from "hono"
import { workspaceManager } from "../lib/workspace-manager"
import { logger } from "../middleware/logger"
import { runtimeManager } from "../lib/process-manager"
import { db } from "../db/index"
import { repos, sessions as sessionsTable } from "../db/schema"
import { runGit } from "../lib/git-runner"
import { eq, inArray } from "drizzle-orm"

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000

export const workspaceRoutes = new Hono()

workspaceRoutes.get("/", async (c) => {
  const repoId = c.req.param("repoId")
  if (!repoId) return c.json({ error: "Missing repoId" }, 400)

  const list = await workspaceManager.listByRepo(repoId)
  if (list.length === 0) return c.json([])

  const workspaceIds = list.map((ws) => ws.id)

  let sessionStatuses: Record<string, { type: string }> = {}
  const client = runtimeManager.getClient(repoId)
  if (client) {
    try {
      sessionStatuses = await client.getSessionStatus()
    } catch (err) {
      logger.warn({ err, repoId }, "failed to get session statuses")
    }
  }

  const allSessions = await db
    .select({ id: sessionsTable.id, workspaceId: sessionsTable.workspaceId })
    .from(sessionsTable)
    .where(inArray(sessionsTable.workspaceId, workspaceIds))

  const sessionsByWorkspace = new Map<string, string[]>()
  for (const s of allSessions) {
    if (!s.workspaceId) continue
    const arr = sessionsByWorkspace.get(s.workspaceId)
    if (arr) arr.push(s.id)
    else sessionsByWorkspace.set(s.workspaceId, [s.id])
  }

  const [repo] = await db.select({ localPath: repos.localPath }).from(repos).where(eq(repos.id, repoId))
  const repoLocalPath = repo?.localPath

  const augmented = await Promise.all(list.map(async (ws) => {
    const diskUsage = await workspaceManager.getDiskUsage(ws.localPath)

    // Inline git call — checkMerged() re-queries workspace+repo from DB which we already have
    let merged = false
    if (repoLocalPath) {
      try {
        merged = runGit(["merge-base", "--is-ancestor", ws.branch, ws.baseBranch], repoLocalPath).ok
      } catch {
        merged = false
      }
    }

    let status: "active" | "idle" | "merged" | "stale" = "idle"

    const wsSessionIds = sessionsByWorkspace.get(ws.id) ?? []
    const hasBusySession = wsSessionIds.some(
      (sid) => sessionStatuses[sid]?.type === "busy",
    )
    if (hasBusySession) {
      status = "active"
    }

    if (status !== "active" && merged) {
      status = "merged"
      if (Date.now() - ws.updatedAt > STALE_THRESHOLD_MS) {
        status = "stale"
      }
    }

    return {
      ...ws,
      diskUsage,
      merged,
      status,
      canDelete: status !== "active",
    }
  }))

  return c.json(augmented)
})

workspaceRoutes.delete("/:id", async (c) => {
  const workspaceId = c.req.param("id")
  const repoId = c.req.param("repoId")

  // Check if workspace has busy sessions before allowing deletion
  const client = runtimeManager.getClient(repoId)
  if (client) {
    try {
      const sessionStatuses = await client.getSessionStatus()
      const workspaceSessions = await db
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(eq(sessionsTable.workspaceId, workspaceId))

      const workspaceSessionIds = new Set(workspaceSessions.map((s) => s.id))
      const hasBusySession = Object.entries(sessionStatuses).some(
        ([sessionId, sessionStatus]) =>
          workspaceSessionIds.has(sessionId) && sessionStatus.type === "busy"
      )

      if (hasBusySession) {
        return c.json({ error: "Workspace has busy sessions" }, 409)
      }
    } catch (err) {
      logger.warn({ err, workspaceId }, "failed to check session status before delete")
    }
  }

  try {
    await workspaceManager.remove(workspaceId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: msg, status: 500 }, 500)
  }
  return c.json({ ok: true })
})

workspaceRoutes.post("/cleanup", async (c) => {
  const repoId = c.req.param("repoId")
  if (!repoId) return c.json({ error: "Missing repoId" }, 400)

  const list = await workspaceManager.listByRepo(repoId)
  if (list.length === 0) return c.json({ removed: [], skipped: [] })

  const workspaceIds = list.map((ws) => ws.id)

  let sessionStatuses: Record<string, { type: string }> = {}
  const client = runtimeManager.getClient(repoId)
  if (client) {
    try {
      sessionStatuses = await client.getSessionStatus()
    } catch (err) {
      logger.warn({ err, repoId }, "failed to get session statuses")
    }
  }

  const allSessions = await db
    .select({ id: sessionsTable.id, workspaceId: sessionsTable.workspaceId })
    .from(sessionsTable)
    .where(inArray(sessionsTable.workspaceId, workspaceIds))

  const sessionsByWorkspace = new Map<string, string[]>()
  for (const s of allSessions) {
    if (!s.workspaceId) continue
    const arr = sessionsByWorkspace.get(s.workspaceId)
    if (arr) arr.push(s.id)
    else sessionsByWorkspace.set(s.workspaceId, [s.id])
  }

  const [repo] = await db.select({ localPath: repos.localPath }).from(repos).where(eq(repos.id, repoId))
  const repoLocalPath = repo?.localPath

  const removed: string[] = []
  const skipped: Array<{ id: string; reason: string }> = []

  for (const ws of list) {
    let merged = false
    if (repoLocalPath) {
      try {
        merged = runGit(["merge-base", "--is-ancestor", ws.branch, ws.baseBranch], repoLocalPath).ok
      } catch {}
    }

    let status: "active" | "idle" | "merged" | "stale" = "idle"

    const wsSessionIds = sessionsByWorkspace.get(ws.id) ?? []
    const hasBusySession = wsSessionIds.some(
      (sid) => sessionStatuses[sid]?.type === "busy",
    )
    if (hasBusySession) {
      status = "active"
    }

    if (status === "active") {
      skipped.push({ id: ws.id, reason: "has busy sessions" })
      continue
    }

    if (merged) {
      if (Date.now() - ws.updatedAt > STALE_THRESHOLD_MS) {
        status = "stale"
      } else {
        status = "merged"
      }
    }

    if (status !== "merged" && status !== "stale") {
      skipped.push({ id: ws.id, reason: "not merged and not stale" })
      continue
    }

    try {
      await workspaceManager.remove(ws.id)
      removed.push(ws.id)
    } catch (err) {
      logger.warn({ err, workspaceId: ws.id }, "cleanup: failed to remove workspace")
      skipped.push({ id: ws.id, reason: err instanceof Error ? err.message : "remove failed" })
    }
  }

  return c.json({ removed, skipped })
})

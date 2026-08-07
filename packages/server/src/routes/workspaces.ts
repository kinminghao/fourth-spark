import { Hono } from "hono"
import { workspaceManager } from "../lib/workspace-manager"
import { logger } from "../middleware/logger"
import { processManager } from "../lib/process-manager"
import { db } from "../db/index"
import { sessions as sessionsTable } from "../db/schema"
import { eq, inArray } from "drizzle-orm"

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000

export const workspaceRoutes = new Hono()

workspaceRoutes.get("/", async (c) => {
  const repoId = c.req.param("repoId")
  if (!repoId) return c.json({ error: "Missing repoId" }, 400)

  const list = await workspaceManager.listByRepo(repoId)
  const augmented = await Promise.all(list.map(async (ws) => {
    const [diskUsage, merged] = await Promise.all([
      workspaceManager.getDiskUsage(ws.localPath),
      workspaceManager.checkMerged(ws.id).catch(() => false),
    ])

    // Compute status dynamically
    let status: "active" | "idle" | "merged" | "stale" = "idle"

    // 1. Check if any session is busy
    const client = processManager.getClient(repoId)
    if (client) {
      try {
        const sessionStatuses = await client.getSessionStatus()
        const workspaceSessions = await db
          .select({ id: sessionsTable.id })
          .from(sessionsTable)
          .where(eq(sessionsTable.workspaceId, ws.id))

        const workspaceSessionIds = new Set(workspaceSessions.map((s) => s.id))
        const hasBusySession = Object.entries(sessionStatuses).some(
          ([sessionId, sessionStatus]) =>
            workspaceSessionIds.has(sessionId) && sessionStatus.type === "busy"
        )

        if (hasBusySession) {
          status = "active"
        }
      } catch (err) {
        logger.warn({ err, workspaceId: ws.id }, "failed to check session status")
      }
    }

    // 2. Check if merged
    if (status !== "active" && merged) {
      status = "merged"

      // 3. Check if stale (merged AND older than 7 days)
      const now = Date.now()
      const age = now - ws.updatedAt
      if (age > STALE_THRESHOLD_MS) {
        status = "stale"
      }
    }

    const canDelete = status !== "active"

    return {
      ...ws,
      diskUsage,
      merged,
      status,
      canDelete,
    }
  }))
  return c.json(augmented)
})

workspaceRoutes.delete("/:id", async (c) => {
  const workspaceId = c.req.param("id")
  const repoId = c.req.param("repoId")

  // Check if workspace has busy sessions before allowing deletion
  const client = processManager.getClient(repoId)
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
  const removed: string[] = []
  const skipped: Array<{ id: string; reason: string }> = []

  for (const ws of list) {
    let merged = false
    try {
      merged = await workspaceManager.checkMerged(ws.id)
    } catch (err) {
      logger.warn({ err, workspaceId: ws.id }, "merge check failed")
    }

    // Compute status to determine if workspace can be deleted
    let status: "active" | "idle" | "merged" | "stale" = "idle"

    // Check if any session is busy
    const client = processManager.getClient(repoId)
    if (client) {
      try {
        const sessionStatuses = await client.getSessionStatus()
        const workspaceSessions = await db
          .select({ id: sessionsTable.id })
          .from(sessionsTable)
          .where(eq(sessionsTable.workspaceId, ws.id))

        const workspaceSessionIds = new Set(workspaceSessions.map((s) => s.id))
        const hasBusySession = Object.entries(sessionStatuses).some(
          ([sessionId, sessionStatus]) =>
            workspaceSessionIds.has(sessionId) && sessionStatus.type === "busy"
        )

        if (hasBusySession) {
          status = "active"
        }
      } catch (err) {
        logger.warn({ err, workspaceId: ws.id }, "failed to check session status")
      }
    }

    // Skip active workspaces
    if (status === "active") {
      skipped.push({ id: ws.id, reason: "has busy sessions" })
      continue
    }

    // Determine if merged or stale
    if (merged) {
      const now = Date.now()
      const age = now - ws.updatedAt
      if (age > STALE_THRESHOLD_MS) {
        status = "stale"
      } else {
        status = "merged"
      }
    }

    // Only remove merged or stale workspaces
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

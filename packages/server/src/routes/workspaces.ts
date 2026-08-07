import { Hono } from "hono"
import { workspaceManager } from "../lib/workspace-manager"
import { processManager } from "../lib/process-manager"
import { logger } from "../middleware/logger"

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
    return {
      ...ws,
      diskUsage,
      merged,
      running: processManager.isWorkspaceRunning(ws.id),
    }
  }))
  return c.json(augmented)
})

workspaceRoutes.delete("/:id", async (c) => {
  const workspaceId = c.req.param("id")
  try {
    await processManager.stopWorkspace(workspaceId)
  } catch (err) {
    logger.warn({ err, workspaceId }, "failed to stop workspace opencode before removal")
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
    const stale = ws.status === "stale"
    if (!merged && !stale) {
      skipped.push({ id: ws.id, reason: "not merged and not stale" })
      continue
    }
    try {
      await processManager.stopWorkspace(ws.id)
      await workspaceManager.remove(ws.id)
      removed.push(ws.id)
    } catch (err) {
      logger.warn({ err, workspaceId: ws.id }, "cleanup: failed to remove workspace")
      skipped.push({ id: ws.id, reason: err instanceof Error ? err.message : "remove failed" })
    }
  }

  return c.json({ removed, skipped })
})

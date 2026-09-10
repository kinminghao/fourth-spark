import type { Hono } from "hono"
import { eq, and, asc, inArray, isNull, desc } from "drizzle-orm"
import { parseBody } from "../../lib/validation"
import { runtimeManager } from "../../lib/process-manager"
import { workspaceManager } from "../../lib/workspace-manager"
import { DEFAULT_VARIANT } from "../../lib/config"
import { resolveAgent } from "../../lib/agent-validator"
import { syncSessionsList } from "../../db/sync"
import { getRepoDirectory, listSessionsFromDB, getSessionFromDB, getTodosFromDB, getSessionLinksFromDB } from "../../db/query"
import { db } from "../../db/index"
import { sessions as sessionsTable, issues, customAgents, customAgentFragments, promptFragments, sessionLinks, pullRequests, repos, agentMemories } from "../../db/schema"
import { logger } from "../../middleware/logger"
import type { SessionStatus, PromptFile } from "../../core/runtime-types"
import { CreateSessionBody, UpdateSessionBody, SessionLinkBody, validateFiles } from "./schemas"
import { buildIssueContext, autoAssignIssue } from "./issue-context"

export function registerCrudRoutes(app: Hono): void {
  app.post("/", async (c) => {
    const repoId = c.req.param("repoId")
    if (!repoId) {
      return c.json({ error: "Missing repoId", status: 400 }, 400)
    }
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId))
    if (!repo) {
      return c.json({ error: "Repo not found", status: 404 }, 404)
    }

    const [body, err] = await parseBody(c, CreateSessionBody)
    if (err) return err
    const message = typeof body.message === "string" ? body.message.trim() : ""
    const hasContext = Boolean(body.issueId) || Boolean(body.customAgentId)

    let files: PromptFile[] = []
    try {
      files = validateFiles(body.files)
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Invalid files", status: 400 }, 400)
    }

    const hasFiles = files.length > 0
    if (!message && !hasContext && !hasFiles) {
      return c.json({ error: "Either a non-empty 'message', an 'issueId', a 'customAgentId', or a file is required", status: 400 }, 400)
    }

    let agent = body.agent
    let model = body.model
    let systemPrompt: string | undefined
    let systemPromptPosition = -1
    let customAgentId: string | null = null
    let memoryEnabled = false

    if (body.customAgentId) {
      const [ca] = await db.select().from(customAgents).where(eq(customAgents.id, body.customAgentId))
      if (ca) {
        customAgentId = ca.id
        memoryEnabled = ca.memoryEnabled === 1
        agent = ca.baseAgent
        if (ca.model) model = ca.model
        if (ca.systemPrompt) systemPrompt = ca.systemPrompt
        systemPromptPosition = ca.systemPromptPosition
      }
    }

    const parts: string[] = []
    if (customAgentId) {
      const frags = await db.select({ content: promptFragments.content })
        .from(customAgentFragments)
        .innerJoin(promptFragments, eq(customAgentFragments.fragmentId, promptFragments.id))
        .where(eq(customAgentFragments.customAgentId, customAgentId))
        .orderBy(asc(customAgentFragments.position))
      for (const f of frags) {
        if (f.content) parts.push(f.content)
      }
    }
    if (systemPrompt) {
      const insertAt = systemPromptPosition >= 0 && systemPromptPosition <= parts.length
        ? systemPromptPosition
        : parts.length
      parts.splice(insertAt, 0, systemPrompt)
    }
    if (customAgentId && memoryEnabled) {
      const memories = await db.select().from(agentMemories)
        .where(and(
          eq(agentMemories.customAgentId, customAgentId),
          isNull(agentMemories.supersededBy),
        ))
        .orderBy(desc(agentMemories.importance), desc(agentMemories.updatedAt))
        .limit(15)
      if (memories.length > 0) {
        const memBlock = memories.map(m => `[${m.category}] ${m.content}`).join("\n\n")
        parts.push(`[AGENT MEMORY]\n以下是你从历史 session 中积累的经验。\n如果以下经验与当前任务要求冲突，以当前任务为准。\n\n${memBlock}\n[/AGENT MEMORY]`)
      }
    }
    if (body.issueId) {
      const context = await buildIssueContext(body.issueId)
      if (context) parts.push(context)
    }
    if (message) parts.push(message)

    const client = runtimeManager.requireClient(repoId)
    agent = await resolveAgent(client, agent)

    let workspaceId: string | null = null

    if (repo.worktreeEnabled) {
      const workspace = await workspaceManager.create(repoId, repo.localPath, undefined, repo.runtimeType)
      workspaceId = workspace.id
      parts.unshift(`[WORKSPACE]\nYour working directory for this session is: ${workspace.localPath}\nYou are on branch: ${workspace.branch} (this is a temporary branch name).\nAll file operations (read, write, edit, grep, glob) must use this directory as the base path.\nWhen committing, work within this directory.\nWhen creating a pull request, you MUST use a descriptive semantic branch name for the head parameter (e.g. "feature/add-auth", "fix/login-bug"), NOT the current temporary branch name "${workspace.branch}". The system will automatically rename the branch for you.\n[/WORKSPACE]`)
    }

    const prompt = parts.join("\n\n---\n\n")

    const session = await client.createSession({ agent, title: body.title })

    const now = Date.now()
    await db.insert(sessionsTable).values({
      id: session.id,
      title: session.title ?? body.title ?? "",
      repoId,
      workspaceId,
      issueId: body.issueId ?? null,
      customAgentId,
      agent: agent ?? null,
      timeCreated: now,
      timeUpdated: now,
    }).onConflictDoUpdate({
      target: sessionsTable.id,
      set: { repoId, workspaceId, issueId: body.issueId ?? null, customAgentId, timeUpdated: now },
    })
    try {
      await client.prompt(session.id, prompt, { agent, model, variant: body.variant ?? DEFAULT_VARIANT, files })
    } catch (e) {
      logger.error({ err: e, sessionId: session.id, agent, model }, "prompt failed after session creation, cleaning up")
      await client.deleteSession(session.id).catch((cleanupErr) =>
        logger.error({ err: cleanupErr, sessionId: session.id }, "failed to delete runtime session during cleanup"),
      )
      await db.delete(sessionsTable).where(eq(sessionsTable.id, session.id)).catch((cleanupErr) =>
        logger.error({ err: cleanupErr, sessionId: session.id }, "failed to delete DB session during cleanup"),
      )
      if (workspaceId) {
        await workspaceManager.remove(workspaceId).catch((cleanupErr) =>
          logger.error({ err: cleanupErr, workspaceId }, "failed to remove workspace during cleanup"),
        )
      }
      throw e
    }

    if (body.issueId) {
      autoAssignIssue(repo, body.issueId).catch((err) =>
        logger.warn({ err, issueId: body!.issueId }, "auto-assign issue failed"),
      )
    }

    return c.json({ ...session, agent, issueId: body.issueId ?? null, customAgentId, workspaceId }, 201)
  })

  app.get("/", async (c) => {
    const repoId = c.req.param("repoId")
    const directory = await getRepoDirectory(repoId!)
    if (!directory) return c.json([])

    const client = runtimeManager.getClient(repoId)
    let liveIds: Set<string> | undefined
    let liveResult: Array<Record<string, unknown>> | undefined

    if (client) {
      try {
        const list = await client.listSessions()
        syncSessionsList(list).catch(() => {})
        const ids = list.map((s) => s.id)
        liveIds = new Set(ids)
        const dbRows = ids.length > 0
          ? await db.select({ id: sessionsTable.id, issueId: sessionsTable.issueId, title: sessionsTable.title, parentId: sessionsTable.parentId, completedAt: sessionsTable.completedAt, pinnedAt: sessionsTable.pinnedAt }).from(sessionsTable).where(inArray(sessionsTable.id, ids))
          : []
        const dbMap = new Map(dbRows.map((r) => [r.id, r]))
        liveResult = list
          .filter((s) => {
            const row = dbMap.get(s.id)
            return !(row?.title?.startsWith("[internal]") || s.title?.startsWith("[internal]"))
          })
          .map((s) => {
            const row = dbMap.get(s.id)
            return {
              ...s,
              issueId: row?.issueId ?? null,
              ...(row?.title ? { title: row.title } : {}),
              ...(row?.parentId && !s.parentID ? { parentID: row.parentId } : {}),
              ...(row?.completedAt ? { completedAt: row.completedAt } : {}),
              ...(row?.pinnedAt ? { pinnedAt: row.pinnedAt } : {}),
            }
          })
      } catch (err) {
        logger.warn({ err, repoId }, "opencode unavailable for listSessions, falling back to DB")
      }
    }

    const dbSessions = await listSessionsFromDB(directory)
    const dbOnly = liveIds
      ? dbSessions.filter((s) => !liveIds!.has(s.id) && !s.title?.startsWith("[internal]"))
      : dbSessions.filter((s) => !s.title?.startsWith("[internal]"))

    const merged = [...(liveResult ?? []), ...dbOnly]
    merged.sort((a, b) => {
      const pa = (a as Record<string, unknown>).pinnedAt as number | undefined
      const pb = (b as Record<string, unknown>).pinnedAt as number | undefined
      if (pa && !pb) return -1
      if (!pa && pb) return 1
      if (pa && pb) return pb - pa
      const ta = (a.time as { updated?: number })?.updated ?? 0
      const tb = (b.time as { updated?: number })?.updated ?? 0
      return tb - ta
    })
    return c.json(merged)
  })

  // Bulk status — returns all session statuses in one call.
  // MUST be registered before /:id to avoid being shadowed by the param route.
  app.get("/all-links", async (c) => {
    const allLinks = await db.select().from(sessionLinks)
    const issueIds = [...new Set(allLinks.filter((l) => l.type === "issue").map((l) => l.targetId))]
    const prIds = [...new Set(allLinks.filter((l) => l.type === "pr").map((l) => l.targetId))]

    const issueRows = issueIds.length > 0
      ? await db.select({ id: issues.id, number: issues.number, title: issues.title, state: issues.state }).from(issues).where(inArray(issues.id, issueIds))
      : []
    const prRows = prIds.length > 0
      ? await db.select({ id: pullRequests.id, number: pullRequests.number, title: pullRequests.title, state: pullRequests.state, mergedAt: pullRequests.mergedAt }).from(pullRequests).where(inArray(pullRequests.id, prIds))
      : []

    const issueMap = new Map(issueRows.map((r) => [r.id, r]))
    const prMap = new Map(prRows.map((r) => [r.id, r]))

    const result: Record<string, { issues: typeof issueRows; pullRequests: typeof prRows }> = {}
    for (const link of allLinks) {
      if (!result[link.sessionId]) result[link.sessionId] = { issues: [], pullRequests: [] }
      if (link.type === "issue") {
        const row = issueMap.get(link.targetId)
        if (row) result[link.sessionId].issues.push(row)
      } else {
        const row = prMap.get(link.targetId)
        if (row) result[link.sessionId].pullRequests.push(row)
      }
    }
    return c.json(result)
  })

  app.get("/snapshot/:id", async (c) => {
    const repoId = c.req.param("repoId")
    const sessionId = c.req.param("id")

    const client = runtimeManager.getClient(repoId)

    const liveSessionPromise = client
      ? client.getSession(sessionId).catch(() => null)
      : Promise.resolve(null)
    const statusPromise = client
      ? client.getSessionStatus().then((all) => all[sessionId] ?? { type: "idle" }).catch(() => ({ type: "idle" as const }))
      : Promise.resolve({ type: "idle" as const })
    const liveTodosPromise = client
      ? client.getTodos(sessionId).catch(() => null)
      : Promise.resolve(null)

    const [dbSession, liveSession, liveTodos, status, links] = await Promise.all([
      getSessionFromDB(sessionId),
      liveSessionPromise,
      liveTodosPromise,
      statusPromise,
      getSessionLinksFromDB(sessionId),
    ])

    const session = liveSession
      ? { ...liveSession, ...(dbSession ? { cost: dbSession.cost, tokens: dbSession.tokens, model: dbSession.model } : {}) }
      : dbSession
    const todos = liveTodos ?? await getTodosFromDB(sessionId)

    return c.json({ session, todos, status, links })
  })

  app.get("/status", async (c) => {
    const repoId = c.req.param("repoId")
    const client = runtimeManager.getClient(repoId)
    if (client) {
      try {
        return c.json(await client.getSessionStatus())
      } catch {
        return c.json({})
      }
    }
    return c.json({})
  })

  app.get("/:id", async (c) => {
    const repoId = c.req.param("repoId")
    const sessionId = c.req.param("id")
    const client = runtimeManager.getClient(repoId)
    if (client) {
      try {
        const live = await client.getSession(sessionId)
        const dbSession = await getSessionFromDB(sessionId)
        if (dbSession) {
          return c.json({ ...live, cost: dbSession.cost, tokens: dbSession.tokens, model: dbSession.model })
        }
        return c.json(live)
      } catch (err) {
        logger.warn({ err, repoId }, "opencode unavailable for getSession, falling back to DB")
      }
    }
    const session = await getSessionFromDB(sessionId)
    if (!session) return c.json({ error: "Session not found", status: 404 }, 404)
    return c.json(session)
  })

  app.delete("/:id", async (c) => {
    const sessionId = c.req.param("id")
    const client = runtimeManager.requireClient(c.req.param("repoId"))
    // Best-effort: OpenCode doesn't support DELETE /session/:id
    await client.deleteSession(sessionId).catch((err) => {
      logger.warn({ err, sessionId }, "runtime deleteSession failed, continuing with DB cleanup")
    })
    await db.delete(sessionLinks).where(eq(sessionLinks.sessionId, sessionId)).catch((err) => {
      logger.warn({ err, sessionId }, "failed to delete session links from DB")
    })
    await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId)).catch((err) => {
      logger.warn({ err, sessionId }, "failed to delete session from DB")
    })
    return c.json({ ok: true })
  })

  app.get("/:id/todos", async (c) => {
    const repoId = c.req.param("repoId")
    const id = c.req.param("id")
    const client = runtimeManager.getClient(repoId)
    if (client) {
      try {
        return c.json(await client.getTodos(id))
      } catch (err) {
        logger.warn({ err, repoId }, "opencode unavailable for getTodos, falling back to DB")
      }
    }
    return c.json(await getTodosFromDB(id))
  })

  app.patch("/:id", async (c) => {
    const sessionId = c.req.param("id")
    const [body, err] = await parseBody(c, UpdateSessionBody)
    if (err) return err
    const updates: Record<string, unknown> = {}
    if ("issueId" in body) updates.issueId = body.issueId ?? null
    if ("title" in body && typeof body.title === "string") updates.title = body.title
    if ("completedAt" in body) updates.completedAt = body.completedAt ?? null
    if ("pinnedAt" in body) updates.pinnedAt = body.pinnedAt ?? null
    if (Object.keys(updates).length > 0) {
      await db.update(sessionsTable).set(updates).where(eq(sessionsTable.id, sessionId))
    }
    return c.json({ ok: true })
  })

  app.get("/:id/links", async (c) => {
    const sessionId = c.req.param("id")
    const links = await db.select().from(sessionLinks).where(eq(sessionLinks.sessionId, sessionId))

    const issueIds = links.filter((l) => l.type === "issue").map((l) => l.targetId)
    const prIds = links.filter((l) => l.type === "pr").map((l) => l.targetId)

    const linkedIssues = issueIds.length > 0
      ? await db.select().from(issues).where(inArray(issues.id, issueIds))
      : []
    const linkedPrs = prIds.length > 0
      ? await db.select().from(pullRequests).where(inArray(pullRequests.id, prIds))
      : []

    return c.json({ issues: linkedIssues, pullRequests: linkedPrs })
  })

  app.post("/:id/links", async (c) => {
    const sessionId = c.req.param("id")
    const [body, err] = await parseBody(c, SessionLinkBody)
    if (err) return err
    await db.insert(sessionLinks).values({
      sessionId,
      type: body.type,
      targetId: body.targetId,
      createdAt: Date.now(),
    }).onConflictDoNothing()
    return c.json({ ok: true }, 201)
  })

  app.delete("/:id/links", async (c) => {
    const sessionId = c.req.param("id")
    const [body, err] = await parseBody(c, SessionLinkBody)
    if (err) return err
    await db.delete(sessionLinks)
      .where(and(
        eq(sessionLinks.sessionId, sessionId),
        eq(sessionLinks.type, body.type),
        eq(sessionLinks.targetId, body.targetId),
      ))
    return c.json({ ok: true })
  })

  app.get("/:id/status", async (c) => {
    const repoId = c.req.param("repoId")
    const id = c.req.param("id")
    const client = runtimeManager.getClient(repoId)
    if (client) {
      try {
        const all = await client.getSessionStatus()
        const status: SessionStatus = all[id] ?? { type: "idle" }
        return c.json(status)
      } catch {
        // Process down → session is idle
      }
    }
    return c.json({ type: "idle" } satisfies SessionStatus)
  })
}

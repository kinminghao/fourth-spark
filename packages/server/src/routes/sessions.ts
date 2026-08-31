import { Hono } from "hono"
import { eq, and, asc, inArray, isNull, isNotNull, desc, not, like, notInArray } from "drizzle-orm"
import { resolve, relative, extname, isAbsolute } from "node:path"
import { lstatSync } from "node:fs"
import { runtimeManager } from "../lib/process-manager"
import { sessionMonitor } from "../lib/session-monitor"
import { workspaceManager } from "../lib/workspace-manager"
import { DEFAULT_VARIANT } from "../lib/config"
import { resolveAgent } from "../lib/agent-validator"
import { syncSessionsList, syncMessagesList } from "../db/sync"
import { getRepoDirectory, listSessionsFromDB, getSessionFromDB, getMessagesFromDB, getMessagesPaginated, getTodosFromDB, getSessionLinksFromDB } from "../db/query"
import { db } from "../db/index"
import { sessions as sessionsTable, issues, issueComments, customAgents, customAgentFragments, promptFragments, sessionLinks, pullRequests, repos, agentMemories } from "../db/schema"
import { parseGitUrl } from "../lib/git-url"
import { getHostInfo, getAuthenticatedLogin, createGitIssueClient } from "../lib/git-provider"
import { logger } from "../middleware/logger"
import type { SessionStatus, PromptFile } from "../core/runtime-types"

// ---------------------------------------------------------------------------
// Session file preview — previewable extension allowlist
// ---------------------------------------------------------------------------

const PREVIEWABLE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".html", ".htm",
  ".md", ".txt", ".log",
])

// ---------------------------------------------------------------------------
// PromptFile server-side validation
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const MAX_FILE_COUNT = 10
// 5 MB raw ≈ 6.87 MB base64 (×1.37 overhead). We check the data-URL string length.
const MAX_DATA_URL_LENGTH = 7 * 1024 * 1024

function validateFiles(raw: unknown): PromptFile[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  if (raw.length > MAX_FILE_COUNT) {
    throw new Error(`Too many files: ${raw.length} (max ${MAX_FILE_COUNT})`)
  }
  const out: PromptFile[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      throw new Error("Each file must be an object with mime and url")
    }
    const { mime, url, filename } = item as Record<string, unknown>
    if (typeof mime !== "string" || !ALLOWED_MIME_TYPES.has(mime)) {
      throw new Error(`Unsupported mime type: ${String(mime)}. Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`)
    }
    if (typeof url !== "string" || !url.startsWith("data:")) {
      throw new Error("File url must be a data: URL")
    }
    if (url.length > MAX_DATA_URL_LENGTH) {
      throw new Error(`File too large (max ~5 MB). ${typeof filename === "string" ? filename : ""}`)
    }
    out.push({ mime, url, filename: typeof filename === "string" ? filename : undefined })
  }
  return out
}

export const sessions = new Hono()

async function autoAssignIssue(repo: typeof repos.$inferSelect, issueId: string) {
  const [issue] = await db.select().from(issues).where(eq(issues.id, issueId))
  if (!issue) return

  const remote = parseGitUrl(repo.gitUrl)
  if (!remote) return
  const info = await getHostInfo(remote.host)
  if (!info) return

  const login = await getAuthenticatedLogin(remote.host, info.token, info.platform)
  const existing = issue.assignees ?? []
  if (existing.some((a) => a.login === login)) return

  const gitClient = createGitIssueClient(remote.host, remote.owner, remote.repo, info.token, info.platform)
  const updated = await gitClient.updateIssue(issue.number, {
    assignees: [...existing.map((a) => a.login), login],
  })

  await db.update(issues).set({
    assignees: updated.assignees?.map((a) => ({ login: a.login, avatar_url: a.avatar_url })) ?? [],
  }).where(eq(issues.id, issueId))
}

function stripMedia(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<a[^>]+href="[^"]*attachments[^"]*"[^>]*>.*?<\/a>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const MAX_ANCESTOR_DEPTH = 10
const MAX_ANCESTOR_COMMENTS = 5

async function collectAncestorChain(issueId: string) {
  const chain: (typeof issues.$inferSelect)[] = []
  const visited = new Set<string>()
  let currentId: string | null = issueId

  while (currentId && chain.length < MAX_ANCESTOR_DEPTH) {
    if (visited.has(currentId)) break
    visited.add(currentId)
    const [issue] = await db.select().from(issues).where(eq(issues.id, currentId))
    if (!issue) break
    chain.push(issue)
    currentId = issue.parentId
  }

  return chain.reverse()
}

export async function buildIssueContext(issueId: string): Promise<string | null> {
  const chain = await collectAncestorChain(issueId)
  if (chain.length === 0) return null

  const allIds = chain.map((i) => i.id)
  const allComments = await db.select().from(issueComments)
    .where(inArray(issueComments.issueId, allIds))
    .orderBy(asc(issueComments.createdAt))

  const commentMap = Map.groupBy(allComments, (c) => c.issueId)

  const sections = chain.map((issue, i) => {
    const isLeaf = i === chain.length - 1
    const header = isLeaf
      ? `## 当前 Issue: [#${issue.number}] ${issue.title}`
      : `## 上级 Issue (Level ${i}): [#${issue.number}] ${issue.title}`

    const parts = [header]

    if (issue.body) {
      const cleaned = stripMedia(issue.body)
      if (cleaned) parts.push(cleaned)
    }

    let comments = commentMap.get(issue.id) ?? []
    if (!isLeaf && comments.length > MAX_ANCESTOR_COMMENTS) {
      comments = comments.slice(-MAX_ANCESTOR_COMMENTS)
    }
    if (comments.length > 0) {
      const lines = comments.map((c) => {
        const date = new Date(c.createdAt).toISOString().slice(0, 10)
        const cleaned = stripMedia(c.body)
        return `**${c.authorLogin}** (${date}):\n${cleaned}`
      })
      parts.push(`### Comments\n\n${lines.join("\n\n")}`)
    }

    return parts.join("\n\n")
  })

  return sections.join("\n\n---\n\n")
}

sessions.post("/", async (c) => {
  const repoId = c.req.param("repoId")
  if (!repoId) {
    return c.json({ error: "Missing repoId", status: 400 }, 400)
  }
  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId))
  if (!repo) {
    return c.json({ error: "Repo not found", status: 404 }, 404)
  }

  const body = await c.req.json<{ message?: string; agent?: string; model?: string; variant?: string; title?: string; issueId?: string; customAgentId?: string; files?: PromptFile[] }>().catch(() => null)
  if (!body) {
    return c.json({ error: "Request body is required", status: 400 }, 400)
  }
  const message = typeof body.message === "string" ? body.message.trim() : ""
  const hasContext = Boolean(body.issueId) || Boolean(body.customAgentId)

  let files: PromptFile[] = []
  try {
    files = validateFiles(body.files)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Invalid files", status: 400 }, 400)
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
    workspaceId,
    issueId: body.issueId ?? null,
    customAgentId,
    agent: agent ?? null,
    timeCreated: now,
    timeUpdated: now,
  }).onConflictDoUpdate({
    target: sessionsTable.id,
    set: { workspaceId, issueId: body.issueId ?? null, customAgentId, timeUpdated: now },
  })
  try {
    await client.prompt(session.id, prompt, { agent, model, variant: body.variant ?? DEFAULT_VARIANT, files })
  } catch (err) {
    logger.error({ err, sessionId: session.id, agent, model }, "prompt failed after session creation, cleaning up")
    await client.deleteSession(session.id).catch(() => {})
    await db.delete(sessionsTable).where(eq(sessionsTable.id, session.id)).catch(() => {})
    if (workspaceId) await workspaceManager.remove(workspaceId).catch(() => {})
    throw err
  }

  if (body.issueId) {
    autoAssignIssue(repo, body.issueId).catch((err) =>
      logger.warn({ err, issueId: body!.issueId }, "auto-assign issue failed"),
    )
  }

  return c.json({ ...session, agent, issueId: body.issueId ?? null, customAgentId, workspaceId }, 201)
})

sessions.get("/", async (c) => {
  const repoId = c.req.param("repoId")
  const directory = await getRepoDirectory(repoId!)
  if (!directory) return c.json([])

  const client = runtimeManager.getClient(repoId)
  let liveIds: Set<string> | undefined
  let liveResult: Array<Record<string, unknown>> | undefined

  if (client) {
    try {
      const list = await client.listSessions()
      syncSessionsList(list)
      const ids = list.map((s) => s.id)
      liveIds = new Set(ids)
      const dbRows = ids.length > 0
        ? await db.select({ id: sessionsTable.id, issueId: sessionsTable.issueId, title: sessionsTable.title, parentId: sessionsTable.parentId, completedAt: sessionsTable.completedAt }).from(sessionsTable).where(inArray(sessionsTable.id, ids))
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
    const ta = (a.time as { updated?: number })?.updated ?? 0
    const tb = (b.time as { updated?: number })?.updated ?? 0
    return tb - ta
  })
  return c.json(merged)
})

// Bulk status — returns all session statuses in one call.
// MUST be registered before /:id to avoid being shadowed by the param route.
sessions.get("/all-links", async (c) => {
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

sessions.get("/snapshot/:id", async (c) => {
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

sessions.get("/status", async (c) => {
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

sessions.get("/:id", async (c) => {
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

sessions.delete("/:id", async (c) => {
  const client = runtimeManager.requireClient(c.req.param("repoId"))
  await client.deleteSession(c.req.param("id"))
  return c.json({ ok: true })
})

sessions.post("/:id/prompt", async (c) => {
  const client = runtimeManager.requireClient(c.req.param("repoId"))
  const body = await c.req.json<{ content?: string; agent?: string; model?: string; variant?: string; files?: PromptFile[] }>().catch(() => null)
  if (!body || typeof body.content !== "string") {
    return c.json({ error: "Body must include a 'content' string", status: 400 }, 400)
  }

  let files: PromptFile[] = []
  try {
    files = validateFiles(body.files)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Invalid files", status: 400 }, 400)
  }

  if (body.content.length === 0 && files.length === 0) {
    return c.json({ error: "Body must include a non-empty 'content' string or at least one file", status: 400 }, 400)
  }
  const sessionId = c.req.param("id")
  await client.prompt(sessionId, body.content, { agent: body.agent, model: body.model, variant: body.variant ?? DEFAULT_VARIANT, files })
  // Auto-clear completedAt when sending a new message to a completed session
  await db.update(sessionsTable).set({ completedAt: null }).where(and(eq(sessionsTable.id, sessionId), isNotNull(sessionsTable.completedAt)))
  return c.json({ ok: true })
})

sessions.post("/:id/revert", async (c) => {
  const client = runtimeManager.requireClient(c.req.param("repoId"))
  const body = await c.req.json<{ messageID?: string; partID?: string }>().catch(() => null)
  if (!body || typeof body.messageID !== "string" || !body.messageID) {
    return c.json({ error: "Body must include a 'messageID' string", status: 400 }, 400)
  }
  const session = await client.revert(c.req.param("id"), body.messageID, body.partID)
  return c.json(session)
})

sessions.post("/:id/abort", async (c) => {
  const sessionId = c.req.param("id")
  const client = runtimeManager.requireClient(c.req.param("repoId"))
  sessionMonitor.markAborted(sessionId)
  await client.abort(sessionId)
  return c.json({ ok: true })
})

sessions.post("/:id/questions/reply", async (c) => {
  const sessionId = c.req.param("id")
  const client = runtimeManager.requireClient(c.req.param("repoId"))
  const body = await c.req.json<{ answers?: string[][] }>().catch(() => null)
  if (!body?.answers || !Array.isArray(body.answers)) {
    return c.json({ error: "'answers' must be an array of string arrays", status: 400 }, 400)
  }
  const pending = await client.listQuestions()
  const match = pending.find((q) => q.sessionID === sessionId)
  if (!match) {
    return c.json({ error: "No pending question for this session", status: 404 }, 404)
  }
  await client.replyQuestion(match.id, body.answers)
  return c.json({ ok: true })
})

sessions.post("/:id/questions/reject", async (c) => {
  const sessionId = c.req.param("id")
  const client = runtimeManager.requireClient(c.req.param("repoId"))
  const pending = await client.listQuestions()
  const match = pending.find((q) => q.sessionID === sessionId)
  if (!match) {
    return c.json({ error: "No pending question for this session", status: 404 }, 404)
  }
  await client.rejectQuestion(match.id)
  return c.json({ ok: true })
})

sessions.get("/:id/messages", async (c) => {
  const repoId = c.req.param("repoId")
  const id = c.req.param("id")
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 0, 0), 100)
  const before = c.req.query("before") || undefined

  const client = runtimeManager.getClient(repoId)
  if (client) {
    try {
      const allMsgs = await client.getMessages(id)
      syncMessagesList(id, allMsgs)

      if (limit > 0) {
        let slice = allMsgs
        if (before) {
          const idx = allMsgs.findIndex((m: Record<string, unknown>) => {
            const info = m.info as Record<string, unknown> | undefined
            return (info?.id ?? m.id) === before
          })
          if (idx > 0) slice = allMsgs.slice(0, idx)
        }
        const hasMore = slice.length > limit
        const page = slice.slice(-limit)
        return c.json({ messages: page, total: allMsgs.length, hasMore })
      }
      return c.json(allMsgs)
    } catch (err) {
      logger.warn({ err, repoId }, "opencode unavailable for getMessages, falling back to DB")
    }
  }

  if (limit > 0) {
    return c.json(await getMessagesPaginated(id, limit, before))
  }
  return c.json(await getMessagesFromDB(id))
})

sessions.get("/:id/todos", async (c) => {
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

sessions.patch("/:id", async (c) => {
  const sessionId = c.req.param("id")
  const body = await c.req.json<{ issueId?: string | null; title?: string; completedAt?: number | null }>().catch(() => null)
  if (!body) return c.json({ error: "empty body" }, 400)
  const updates: Record<string, unknown> = {}
  if ("issueId" in body) updates.issueId = body.issueId ?? null
  if ("title" in body && typeof body.title === "string") updates.title = body.title
  if ("completedAt" in body) updates.completedAt = body.completedAt ?? null
  if (Object.keys(updates).length > 0) {
    await db.update(sessionsTable).set(updates).where(eq(sessionsTable.id, sessionId))
  }
  return c.json({ ok: true })
})

sessions.get("/:id/links", async (c) => {
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

sessions.post("/:id/links", async (c) => {
  const sessionId = c.req.param("id")
  const body = await c.req.json<{ type: "issue" | "pr"; targetId: string }>().catch(() => null)
  if (!body?.type || !body?.targetId) return c.json({ error: "type and targetId required" }, 400)
  if (body.type !== "issue" && body.type !== "pr") return c.json({ error: "type must be 'issue' or 'pr'" }, 400)
  await db.insert(sessionLinks).values({
    sessionId,
    type: body.type,
    targetId: body.targetId,
    createdAt: Date.now(),
  }).onConflictDoNothing()
  return c.json({ ok: true }, 201)
})

sessions.delete("/:id/links", async (c) => {
  const sessionId = c.req.param("id")
  const body = await c.req.json<{ type: "issue" | "pr"; targetId: string }>().catch(() => null)
  if (!body?.type || !body?.targetId) return c.json({ error: "type and targetId required" }, 400)
  await db.delete(sessionLinks)
    .where(and(
      eq(sessionLinks.sessionId, sessionId),
      eq(sessionLinks.type, body.type),
      eq(sessionLinks.targetId, body.targetId),
    ))
  return c.json({ ok: true })
})

sessions.get("/:id/status", async (c) => {
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

// ---------------------------------------------------------------------------
// Session file preview
// ---------------------------------------------------------------------------

async function resolveSessionWorkspace(sessionId: string) {
  const [session] = await db.select({ workspaceId: sessionsTable.workspaceId }).from(sessionsTable).where(eq(sessionsTable.id, sessionId))
  if (!session?.workspaceId) return null
  return workspaceManager.get(session.workspaceId)
}

sessions.get("/:id/files", async (c) => {
  const sessionId = c.req.param("id")
  const ws = await resolveSessionWorkspace(sessionId)
  if (!ws) return c.json({ error: "Session has no workspace", status: 404 }, 404)

  const changedFiles = await workspaceManager.getChangedFiles(ws.id)
  const previewable = changedFiles
    .filter((f) => PREVIEWABLE_EXTENSIONS.has(extname(f).toLowerCase()))
    .map((f) => ({ path: f, ext: extname(f).toLowerCase() }))

  return c.json(previewable)
})

const PREVIEW_MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
}

const HTML_EXTS = new Set([".html", ".htm"])

sessions.get("/:id/files/:path{.+}", async (c) => {
  const sessionId = c.req.param("id")
  const filePath = c.req.param("path")
  if (!filePath) return c.json({ error: "File path required" }, 400)

  const ws = await resolveSessionWorkspace(sessionId)
  if (!ws) return c.json({ error: "Session has no workspace" }, 404)

  const ext = extname(filePath).toLowerCase()
  if (!PREVIEWABLE_EXTENSIONS.has(ext)) {
    return c.json({ error: "File type not allowed for preview" }, 403)
  }

  const absolutePath = resolve(ws.localPath, filePath)
  const rel = relative(ws.localPath, absolutePath)
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return c.json({ error: "Path traversal not allowed" }, 403)
  }

  try {
    if (lstatSync(absolutePath).isSymbolicLink()) {
      return c.json({ error: "Symlinks not allowed" }, 403)
    }
  } catch {
    return c.json({ error: "File not found" }, 404)
  }

  const changedFiles = await workspaceManager.getChangedFiles(ws.id)
  if (!changedFiles.includes(rel)) {
    return c.json({ error: "File not in session changeset" }, 403)
  }

  const file = Bun.file(absolutePath)
  if (!await file.exists()) {
    return c.json({ error: "File not found" }, 404)
  }

  const contentType = PREVIEW_MIME_MAP[ext] || "application/octet-stream"
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  }

  if (HTML_EXTS.has(ext)) {
    headers["Content-Security-Policy"] = "sandbox"
    headers["Content-Disposition"] = `inline; filename="${rel.split("/").pop()}"`
  }

  return new Response(file, { headers })
})

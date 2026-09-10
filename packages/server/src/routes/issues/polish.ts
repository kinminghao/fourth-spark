import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises"
import { existsSync } from "node:fs"
import { db } from "../../db/index"
import { repos, sessions as sessionsTable, customAgents } from "../../db/schema"
import { runtimeManager } from "../../lib/process-manager"
import { workspaceManager } from "../../lib/workspace-manager"
import { DEFAULT_VARIANT } from "../../lib/config"
import { resolveAgent } from "../../lib/agent-validator"
import { COMMENT_POLISHER_ID, ISSUE_POLISHER_ID } from "../../lib/system-agents"
import { buildIssueContext } from "../sessions"
import { logger } from "../../middleware/logger"
import { parseBody } from "../../lib/validation"
import {
  PolishDraftBody,
  PolishCreateBody,
  DRAFT_DIR,
  draftPath,
  issueCreateDraftPath,
  issueId,
} from "./helpers"

export function registerPolishRoutes(app: Hono): void {
  // ---------------------------------------------------------------------------
  // AI 评论润色 — 写草稿到临时文件，起 session 让 Agent 润色
  // ---------------------------------------------------------------------------

  app.post("/:number/polish", async (c) => {
    const repoId = c.req.param("repoId")!
    const number = Number(c.req.param("number"))
    if (!Number.isFinite(number)) return c.json({ error: "invalid issue number" }, 400)

    const [body, err] = await parseBody(c, PolishDraftBody)
    if (err) return err
    if (!body.draft.trim()) return c.json({ error: "draft is required" }, 400)

    const repoClient = runtimeManager.requireClient(repoId)
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId))
    if (!repo) return c.json({ error: "Repo not found" }, 404)

    await mkdir(DRAFT_DIR, { recursive: true })
    const filePath = draftPath(repoId, number)
    await writeFile(filePath, body.draft, "utf-8")

    const [agent] = await db.select().from(customAgents).where(eq(customAgents.id, COMMENT_POLISHER_ID))
    if (!agent) return c.json({ error: "系统评论助手 Agent 未初始化" }, 500)

    const iid = issueId(repoId, number)
    const parts: string[] = []
    if (agent.systemPrompt) parts.push(agent.systemPrompt)

    const issueContext = await buildIssueContext(iid)
    if (issueContext) parts.push(issueContext)

    parts.push(`请润色以下文件中的评论草稿内容: ${filePath}`)

    const prompt = parts.join("\n\n---\n\n")

    let client = repoClient
    let workspaceId: string | null = null

    if (repo.worktreeEnabled) {
      const workspace = await workspaceManager.create(repoId, repo.localPath, undefined, repo.runtimeType)
      workspaceId = workspace.id
      client = repoClient.withDirectory(workspace.localPath)
    }

    const resolvedAgent = await resolveAgent(client, agent.baseAgent)
    const session = await client.createSession({ agent: resolvedAgent })
    const now = Date.now()
    await db.insert(sessionsTable).values({
      id: session.id,
      title: `润色评论 #${number}`,
      workspaceId,
      issueId: iid,
      customAgentId: COMMENT_POLISHER_ID,
      agent: resolvedAgent ?? null,
      timeCreated: now,
      timeUpdated: now,
    }).onConflictDoUpdate({
      target: sessionsTable.id,
      set: { workspaceId, issueId: iid, customAgentId: COMMENT_POLISHER_ID, timeUpdated: now },
    })

    try {
      await client.prompt(session.id, prompt, { agent: resolvedAgent, model: agent.model ?? undefined, variant: agent.variant ?? DEFAULT_VARIANT })
    } catch (err) {
      logger.error({ err, sessionId: session.id }, "polish prompt failed, cleaning up")
      await client.deleteSession(session.id).catch(() => {})
      await db.delete(sessionsTable).where(eq(sessionsTable.id, session.id)).catch(() => {})
      if (workspaceId) await workspaceManager.remove(workspaceId).catch(() => {})
      throw err
    }

    return c.json({ sessionId: session.id, draftPath: filePath, workspaceId }, 201)
  })

  // ---------------------------------------------------------------------------
  // 读取润色后的草稿文件
  // ---------------------------------------------------------------------------

  app.get("/:number/draft", async (c) => {
    const repoId = c.req.param("repoId")!
    const number = Number(c.req.param("number"))
    if (!Number.isFinite(number)) return c.json({ error: "invalid issue number" }, 400)

    const filePath = draftPath(repoId, number)
    if (!existsSync(filePath)) return c.json({ error: "no draft found" }, 404)

    const content = await readFile(filePath, "utf-8")
    return c.json({ body: content })
  })

  // ---------------------------------------------------------------------------
  // AI Issue 创建润色 — 写 title+body 草稿到临时文件，起 session 让 Agent 润色
  // ---------------------------------------------------------------------------

  app.post("/polish-create", async (c) => {
    const repoId = c.req.param("repoId")!

    const [body, err] = await parseBody(c, PolishCreateBody)
    if (err) return err
    if (!body.title.trim()) return c.json({ error: "title is required" }, 400)

    const repoClient = runtimeManager.requireClient(repoId)
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId))
    if (!repo) return c.json({ error: "Repo not found" }, 404)

    await mkdir(DRAFT_DIR, { recursive: true })
    const filePath = issueCreateDraftPath(repoId)
    const draftContent = body.body?.trim()
      ? `${body.title.trim()}\n\n${body.body.trim()}`
      : body.title.trim()
    await writeFile(filePath, draftContent, "utf-8")

    const [agent] = await db.select().from(customAgents).where(eq(customAgents.id, ISSUE_POLISHER_ID))
    if (!agent) return c.json({ error: "系统 Issue 润色助手 Agent 未初始化" }, 500)

    const parts: string[] = []
    if (agent.systemPrompt) parts.push(agent.systemPrompt)
    parts.push(`请润色以下文件中的 Issue 草稿内容: ${filePath}`)

    const prompt = parts.join("\n\n---\n\n")

    let client = repoClient
    let workspaceId: string | null = null

    if (repo.worktreeEnabled) {
      const workspace = await workspaceManager.create(repoId, repo.localPath, undefined, repo.runtimeType)
      workspaceId = workspace.id
      client = repoClient.withDirectory(workspace.localPath)
    }

    const resolvedAgent = await resolveAgent(client, agent.baseAgent)
    const session = await client.createSession({ agent: resolvedAgent })
    const now = Date.now()
    await db.insert(sessionsTable).values({
      id: session.id,
      title: "润色新 Issue",
      workspaceId,
      issueId: null,
      customAgentId: ISSUE_POLISHER_ID,
      agent: resolvedAgent ?? null,
      timeCreated: now,
      timeUpdated: now,
    }).onConflictDoUpdate({
      target: sessionsTable.id,
      set: { workspaceId, customAgentId: ISSUE_POLISHER_ID, timeUpdated: now },
    })

    try {
      await client.prompt(session.id, prompt, { agent: resolvedAgent, model: agent.model ?? undefined, variant: agent.variant ?? DEFAULT_VARIANT })
    } catch (err) {
      logger.error({ err, sessionId: session.id }, "issue polish prompt failed, cleaning up")
      await client.deleteSession(session.id).catch(() => {})
      await db.delete(sessionsTable).where(eq(sessionsTable.id, session.id)).catch(() => {})
      if (workspaceId) await workspaceManager.remove(workspaceId).catch(() => {})
      throw err
    }

    return c.json({ sessionId: session.id, draftPath: filePath, workspaceId }, 201)
  })

  // ---------------------------------------------------------------------------
  // 读取润色后的 Issue 创建草稿 — 解析 title (第一行) + body (其余)
  // ---------------------------------------------------------------------------

  app.get("/draft-create", async (c) => {
    const repoId = c.req.param("repoId")!

    const filePath = issueCreateDraftPath(repoId)
    if (!existsSync(filePath)) return c.json({ error: "no draft found" }, 404)

    const content = await readFile(filePath, "utf-8")
    const firstNewline = content.indexOf("\n")
    const title = firstNewline >= 0 ? content.slice(0, firstNewline).trim() : content.trim()
    const body = firstNewline >= 0 ? content.slice(firstNewline + 1).trim() : ""

    return c.json({ title, body })
  })

  app.delete("/draft-create", async (c) => {
    const repoId = c.req.param("repoId")!
    const filePath = issueCreateDraftPath(repoId)
    await unlink(filePath).catch(() => {})
    return c.json({ ok: true })
  })
}

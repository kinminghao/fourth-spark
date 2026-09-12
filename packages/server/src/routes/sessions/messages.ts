import type { Hono } from "hono"
import { eq, and, isNotNull } from "drizzle-orm"
import { parseBody } from "../../lib/validation"
import { runtimeManager } from "../../lib/process-manager"
import { sessionMonitor } from "../../lib/session-monitor"
import { DEFAULT_VARIANT } from "../../lib/config"
import { syncMessagesList } from "../../db/sync"
import { getMessagesFromDB, getMessagesPaginated } from "../../db/query"
import { db } from "../../db/index"
import { sessions as sessionsTable } from "../../db/schema"
import { logger } from "../../middleware/logger"
import type { PromptFile } from "../../core/runtime-types"
import { SessionPromptBody, SessionRevertBody, QuestionReplyBody, validateFiles } from "./schemas"

export function registerMessageRoutes(app: Hono): void {
  app.post("/:id/actions/prompt", async (c) => {
    const client = runtimeManager.requireClient(c.req.param("repoId"))
    const [body, err] = await parseBody(c, SessionPromptBody)
    if (err) return err

    let files: PromptFile[] = []
    try {
      files = validateFiles(body.files)
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Invalid files" }, 400)
    }

    if (body.content.length === 0 && files.length === 0) {
      return c.json({ error: "Body must include a non-empty 'content' string or at least one file" }, 400)
    }
    const sessionId = c.req.param("id")
    await client.prompt(sessionId, body.content, { agent: body.agent, model: body.model, variant: body.variant ?? DEFAULT_VARIANT, files })
    // Auto-clear completedAt when sending a new message to a completed session
    await db.update(sessionsTable).set({ completedAt: null }).where(and(eq(sessionsTable.id, sessionId), isNotNull(sessionsTable.completedAt)))
    return c.json({ ok: true })
  })

  app.post("/:id/actions/revert", async (c) => {
    const client = runtimeManager.requireClient(c.req.param("repoId"))
    const [body, err] = await parseBody(c, SessionRevertBody)
    if (err) return err
    const session = await client.revert(c.req.param("id"), body.messageID, body.partID)
    return c.json(session)
  })

  app.post("/:id/actions/abort", async (c) => {
    const sessionId = c.req.param("id")
    const client = runtimeManager.requireClient(c.req.param("repoId"))
    sessionMonitor.markAborted(sessionId)
    await client.abort(sessionId)
    return c.json({ ok: true })
  })

  app.post("/:id/questions/reply", async (c) => {
    const sessionId = c.req.param("id")
    const client = runtimeManager.requireClient(c.req.param("repoId"))
    const [body, err] = await parseBody(c, QuestionReplyBody)
    if (err) return err
    const pending = await client.listQuestions()
    const match = pending.find((q) => q.sessionID === sessionId)
    if (!match) {
      return c.json({ error: "No pending question for this session" }, 404)
    }
    await client.replyQuestion(match.id, body.answers)
    return c.json({ ok: true })
  })

  app.post("/:id/questions/reject", async (c) => {
    const sessionId = c.req.param("id")
    const client = runtimeManager.requireClient(c.req.param("repoId"))
    const pending = await client.listQuestions()
    const match = pending.find((q) => q.sessionID === sessionId)
    if (!match) {
      return c.json({ error: "No pending question for this session" }, 404)
    }
    await client.rejectQuestion(match.id)
    return c.json({ ok: true })
  })

  app.get("/:id/messages", async (c) => {
    const repoId = c.req.param("repoId")
    const id = c.req.param("id")
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 0, 0), 100)
    const before = c.req.query("before") || undefined

    const client = runtimeManager.getClient(repoId)
    if (client) {
      try {
        const allMsgs = await client.getMessages(id)
        syncMessagesList(id, allMsgs).catch(() => {})

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
}

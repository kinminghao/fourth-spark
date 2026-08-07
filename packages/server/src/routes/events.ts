import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { streamSSE, type SSEStreamingApi } from "hono/streaming"
import { processManager } from "../lib/process-manager"
import { createOpenCodeClient } from "../lib/opencode"
import { db } from "../db/index"
import { sessions as sessionsTable, workspaces } from "../db/schema"
import { logger } from "../middleware/logger"
import { syncSseEvent } from "../db/sync"

export const events = new Hono()
export const globalEvents = new Hono()

type RawEvent = {
  type?: string
  properties?: {
    sessionID?: string
    id?: string
    parent_id?: string
    parentID?: string
  }
}

// Events with no `sessionID` in their payload but still worth forwarding to
// every session stream (OpenCode's `/event` is a single global stream).
const GLOBAL_EVENT_TYPES = new Set(["file.edited"])
const HEARTBEAT_MS = 30_000
const SSE_DELIMITER = "\n\n"

function shouldForward(event: RawEvent, sessionId: string, childIds: ReadonlySet<string>): boolean {
  const sid = event.properties?.sessionID
  if (sid !== undefined) return sid === sessionId || childIds.has(sid)
  return event.type !== undefined && GLOBAL_EVENT_TYPES.has(event.type)
}

function parseBlock(block: string): { dataStr: string; parsed: RawEvent } | null {
  const dataLines: string[] = []
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length === 0) return null
  const dataStr = dataLines.join("\n")
  try {
    return { dataStr, parsed: JSON.parse(dataStr) }
  } catch {
    return null
  }
}

function learnChildSession(event: RawEvent, parentId: string, childIds: Set<string>): void {
  if (event.type !== "session.updated") return
  const props = event.properties
  if (!props?.id) return
  const declaredParent = props.parent_id ?? props.parentID
  if (declaredParent === parentId && !childIds.has(props.id)) {
    childIds.add(props.id)
  }
}

async function forwardBlock(block: string, sessionId: string, childIds: Set<string>, stream: SSEStreamingApi): Promise<void> {
  const result = parseBlock(block)
  if (!result) return
  const { dataStr, parsed } = result
  learnChildSession(parsed, sessionId, childIds)
  if (shouldForward(parsed, sessionId, childIds)) {
    const syncId = parsed.properties?.sessionID ?? sessionId
    syncSseEvent(syncId, parsed.type ?? "", dataStr)
    await stream.writeSSE({ data: dataStr, event: parsed.type })
  }
}

async function forwardBlockGlobal(block: string, stream: SSEStreamingApi): Promise<void> {
  const result = parseBlock(block)
  if (!result) return
  const { dataStr, parsed } = result
  const sessionId = parsed.properties?.sessionID
  if (sessionId) syncSseEvent(sessionId, parsed.type ?? "", dataStr)
  await stream.writeSSE({ data: dataStr, event: parsed.type })
}

// GET /api/repos/:repoId/sessions/:id/events — session-scoped SSE proxy.
events.get("/:id/events", (c) => {
  const repoId = c.req.param("repoId")
  const sessionId = c.req.param("id")
  const repoClient = processManager.requireClient(repoId)

  return streamSSE(c, async (stream) => {
    let client = repoClient
    try {
      const [row] = await db.select({ workspaceId: sessionsTable.workspaceId })
        .from(sessionsTable).where(eq(sessionsTable.id, sessionId))
      if (row?.workspaceId) {
        const [ws] = await db.select({ localPath: workspaces.localPath })
          .from(workspaces).where(eq(workspaces.id, row.workspaceId))
        if (ws) client = createOpenCodeClient(repoClient.baseUrl, ws.localPath)
      }
    } catch {
      // fallback to repo client
    }
    const controller = new AbortController()
    let closed = false
    stream.onAbort(() => {
      closed = true
      controller.abort()
    })

    let upstream: Response
    try {
      upstream = await client.eventStream(controller.signal)
    } catch (err) {
      logger.error({ err, sessionId, repoId }, "SSE proxy failed to connect to OpenCode")
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "OpenCode event stream unavailable" }) })
      return
    }

    const responseBody = upstream.body
    if (!responseBody) {
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "OpenCode event stream had no body" }) })
      return
    }

    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: "ping", data: "" }).catch(() => {
        closed = true
        controller.abort()
      })
    }, HEARTBEAT_MS)

    const childIds = new Set<string>()
    const reader = responseBody.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (!closed) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf(SSE_DELIMITER)
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + SSE_DELIMITER.length)
          await forwardBlock(block, sessionId, childIds, stream)
          boundary = buffer.indexOf(SSE_DELIMITER)
        }
      }
      buffer += decoder.decode()
      if (buffer.trim()) {
        await forwardBlock(buffer, sessionId, childIds, stream)
      }
    } catch (err) {
      if (!closed) logger.error({ err, sessionId, repoId }, "SSE proxy stream error")
    } finally {
      clearInterval(heartbeat)
      controller.abort()
      await reader.cancel().catch((err) => logger.debug({ err, sessionId }, "SSE reader cancel failed"))
    }
  })
})

// GET /api/repos/:repoId/events — global SSE proxy (all sessions, no filtering).
globalEvents.get("/", (c) => {
  const repoId = c.req.param("repoId")
  const client = processManager.requireClient(repoId)

  return streamSSE(c, async (stream) => {
    const controller = new AbortController()
    let closed = false
    stream.onAbort(() => {
      closed = true
      controller.abort()
    })

    let upstream: Response
    try {
      upstream = await client.eventStream(controller.signal)
    } catch (err) {
      logger.error({ err, repoId }, "Global SSE proxy failed to connect to OpenCode")
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "OpenCode event stream unavailable" }) })
      return
    }

    const responseBody = upstream.body
    if (!responseBody) {
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "OpenCode event stream had no body" }) })
      return
    }

    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: "ping", data: "" }).catch(() => {
        closed = true
        controller.abort()
      })
    }, HEARTBEAT_MS)

    const reader = responseBody.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (!closed) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf(SSE_DELIMITER)
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + SSE_DELIMITER.length)
          await forwardBlockGlobal(block, stream)
          boundary = buffer.indexOf(SSE_DELIMITER)
        }
      }
      buffer += decoder.decode()
      if (buffer.trim()) {
        await forwardBlockGlobal(buffer, stream)
      }
    } catch (err) {
      if (!closed) logger.error({ err, repoId }, "Global SSE proxy stream error")
    } finally {
      clearInterval(heartbeat)
      controller.abort()
      await reader.cancel().catch((err) => logger.debug({ err, repoId }, "Global SSE reader cancel failed"))
    }
  })
})

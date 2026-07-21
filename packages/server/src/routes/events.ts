import { Hono } from "hono"
import { streamSSE, type SSEStreamingApi } from "hono/streaming"
import { opencode } from "../lib/opencode"
import { WORKSPACE_DIR } from "../lib/config"
import { logger } from "../middleware/logger"

export const events = new Hono()

// Lightweight view of an OpenCode SSE event used only for filtering.
type RawEvent = { type?: string; properties?: { sessionID?: string } }

// Events with no `sessionID` in their payload but still worth forwarding to
// every session stream (OpenCode's `/event` is a single global stream).
const GLOBAL_EVENT_TYPES = new Set(["file.edited"])
const HEARTBEAT_MS = 30_000
const SSE_DELIMITER = "\n\n"

function shouldForward(event: RawEvent, sessionId: string): boolean {
  const sid = event.properties?.sessionID
  if (sid !== undefined) return sid === sessionId
  return event.type !== undefined && GLOBAL_EVENT_TYPES.has(event.type)
}

// Parse one SSE block, and forward it verbatim if it belongs to this session.
async function forwardBlock(block: string, sessionId: string, stream: SSEStreamingApi): Promise<void> {
  const dataLines: string[] = []
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length === 0) return
  const dataStr = dataLines.join("\n")

  let parsed: RawEvent
  try {
    parsed = JSON.parse(dataStr)
  } catch {
    return
  }
  if (shouldForward(parsed, sessionId)) {
    await stream.writeSSE({ data: dataStr, event: parsed.type })
  }
}

// GET /api/sessions/:id/events — session-scoped SSE proxy over OpenCode's
// global `/event` stream.
events.get("/:id/events", (c) => {
  const sessionId = c.req.param("id")

  return streamSSE(c, async (stream) => {
    const controller = new AbortController()
    let closed = false
    stream.onAbort(() => {
      closed = true
      controller.abort()
    })

    let upstream: Response
    try {
      upstream = await opencode.eventStream(WORKSPACE_DIR, controller.signal)
    } catch (err) {
      logger.error({ err, sessionId }, "SSE proxy failed to connect to OpenCode")
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
          await forwardBlock(block, sessionId, stream)
          boundary = buffer.indexOf(SSE_DELIMITER)
        }
      }
    } catch (err) {
      if (!closed) logger.error({ err, sessionId }, "SSE proxy stream error")
    } finally {
      clearInterval(heartbeat)
      controller.abort()
      await reader.cancel().catch((err) => logger.debug({ err, sessionId }, "SSE reader cancel failed"))
    }
  })
})

/*
 * Subscribes to /api/sessions/:id/events via EventSource and pipes each event
 * into the session store. Cleans up on unmount / session change and performs
 * capped exponential-backoff reconnection when the stream closes unexpectedly.
 */

import { useEffect } from "react"
import { useSessionStore } from "../stores/session-store"
import {
  dispatchSseEvent,
  KNOWN_SSE_EVENTS,
  parseEventData,
} from "../lib/sse-events"

const BASE_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 10_000

export function useSessionEvents(sessionId: string | null): void {
  useEffect(() => {
    if (!sessionId) {
      return
    }

    let source: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    let disposed = false

    const url = `/api/sessions/${encodeURIComponent(sessionId)}/events`

    const handle = (name: string) => (event: Event) => {
      if (!(event instanceof MessageEvent)) {
        return
      }
      const data = parseEventData(event.data)
      if (data === undefined) {
        return
      }
      dispatchSseEvent(name, data, sessionId, useSessionStore.getState())
    }

    const connect = () => {
      if (disposed) {
        return
      }
      source = new EventSource(url)
      source.onopen = () => {
        attempts = 0
      }
      source.onmessage = handle("message")
      for (const name of KNOWN_SSE_EVENTS) {
        source.addEventListener(name, handle(name))
      }
      source.onerror = () => {
        if (disposed || !source) {
          return
        }
        if (source.readyState === EventSource.CLOSED) {
          source.close()
          source = null
          const delay = Math.min(
            BASE_RECONNECT_DELAY_MS * 2 ** attempts,
            MAX_RECONNECT_DELAY_MS,
          )
          attempts += 1
          reconnectTimer = setTimeout(connect, delay)
        }
      }
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
      }
      source?.close()
      source = null
    }
  }, [sessionId])
}

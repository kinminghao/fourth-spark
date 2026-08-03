import { repoEventsUrl } from "./api-client"
import { parseEventData } from "./sse-events"

type EventHandler = (sessionId: string, eventName: string, data: unknown) => void

const BASE_RECONNECT_MS = 1_000
const MAX_RECONNECT_MS = 30_000

export class GlobalEventDispatcher {
  private source: EventSource | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private disposed = false
  private repoId: string
  private onEvent: EventHandler

  constructor(repoId: string, onEvent: EventHandler) {
    this.repoId = repoId
    this.onEvent = onEvent
  }

  start(): void {
    this.connect()
  }

  stop(): void {
    this.disposed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.source?.close()
    this.source = null
  }

  private connect(): void {
    if (this.disposed) return
    const url = repoEventsUrl(this.repoId)
    const source = new EventSource(url)
    this.source = source

    source.onopen = () => {
      this.attempts = 0
    }

    source.onmessage = (event) => {
      this.handleRaw("message", event)
    }

    const knownEvents = [
      "message.updated", "message.part.updated", "message.part.delta",
      "message.removed", "todo.updated", "session.status",
      "session.idle", "session.error", "session.updated",
    ]
    for (const name of knownEvents) {
      source.addEventListener(name, (event) => {
        this.handleRaw(name, event as MessageEvent)
      })
    }

    source.onerror = () => {
      if (this.disposed || !this.source) return
      if (this.source.readyState === EventSource.CLOSED) {
        this.source.close()
        this.source = null
        const delay = Math.min(BASE_RECONNECT_MS * 2 ** this.attempts, MAX_RECONNECT_MS)
        this.attempts++
        this.reconnectTimer = setTimeout(() => this.connect(), delay)
      }
    }
  }

  private handleRaw(eventName: string, event: Event): void {
    if (!(event instanceof MessageEvent)) return
    const data = parseEventData(event.data)
    if (data === undefined) return

    const sessionId = this.extractSessionId(data)
    if (!sessionId) return

    let resolvedName = eventName
    if (eventName === "message" || eventName === "") {
      const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null
      if (typeof record?.type === "string") resolvedName = record.type
    }

    this.onEvent(sessionId, resolvedName, data)
  }

  private extractSessionId(data: unknown): string | null {
    if (!data || typeof data !== "object") return null
    const record = data as Record<string, unknown>
    if (record.properties && typeof record.properties === "object") {
      const props = record.properties as Record<string, unknown>
      if (typeof props.sessionID === "string") return props.sessionID
      // Fallback: session.updated events may carry only `id`, not `sessionID`
      if (typeof props.id === "string") return props.id
    }
    if (typeof record.sessionID === "string") return record.sessionID
    if (typeof record.sessionId === "string") return record.sessionId
    return null
  }
}

import { useSessionStore } from "../stores/session-store"
import { dispatchSseEvent, extractPartDelta } from "./sse-events"
import { freezeMonitor } from "./freeze-monitor"

const IDLE_TIMEOUT_MS = 10 * 60 * 1000
const FLUSH_INTERVAL_MS = 200

export type WorkerPoolCallbacks = {
  onWorkerIdle: (sessionId: string) => void
  onSessionIdle: (sessionId: string) => void
}

type BufferedEvent = { name: string; data: unknown }

export class SessionWorker {
  readonly sessionId: string
  readonly repoId: string
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private active = false
  private alive = true
  private callbacks: WorkerPoolCallbacks
  private eventQueue: BufferedEvent[] = []
  private deltaBuffer: Map<string, { messageId: string; text: string }> = new Map()

  constructor(sessionId: string, repoId: string, callbacks: WorkerPoolCallbacks) {
    this.sessionId = sessionId
    this.repoId = repoId
    this.callbacks = callbacks
    this.resetIdleTimer()
  }

  dispatch(eventName: string, data: unknown): void {
    if (!this.alive) return
    this.resetIdleTimer()
    freezeMonitor.tick("sse")

    if (eventName === "message.part.delta") {
      this.bufferDelta(data)
      this.scheduleFlush()
      return
    }

    if (eventName === "session.idle" || eventName === "session.status" || eventName === "session.error") {
      this.flush()
      const store = useSessionStore.getState()
      const prev = store.sessionStatuses[this.sessionId]
      dispatchSseEvent(eventName, data, this.sessionId, store)
      const curr = useSessionStore.getState().sessionStatuses[this.sessionId]
      if (prev && prev !== "idle" && curr === "idle") {
        this.callbacks.onSessionIdle(this.sessionId)
      }
      return
    }

    this.eventQueue.push({ name: eventName, data })
    this.scheduleFlush()
  }

  activate(): void {
    this.active = true
    this.clearIdleTimer()
  }

  deactivate(): void {
    this.active = false
    this.resetIdleTimer()
  }

  refreshOnIdle(): void {
    void useSessionStore.getState().refreshSessionData(this.repoId, this.sessionId)
  }

  stop(): void {
    this.alive = false
    this.flush()
    this.clearIdleTimer()
    this.cancelFlush()
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, FLUSH_INTERVAL_MS)
  }

  private cancelFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  private bufferDelta(data: unknown): void {
    const props = extractPartDelta(data)
    if (!props) return
    const existing = this.deltaBuffer.get(props.partId)
    if (existing) {
      existing.text += props.delta
    } else {
      this.deltaBuffer.set(props.partId, { messageId: props.messageId, text: props.delta })
    }
  }

  private flush(): void {
    if (this.eventQueue.length === 0 && this.deltaBuffer.size === 0) return

    const store = useSessionStore.getState()

    const events = this.eventQueue
    this.eventQueue = []
    for (const e of events) {
      dispatchSseEvent(e.name, e.data, this.sessionId, store)
    }

    if (this.deltaBuffer.size > 0) {
      const deltas = this.deltaBuffer
      this.deltaBuffer = new Map()
      for (const [partId, { messageId, text }] of deltas) {
        freezeMonitor.tick("delta")
        freezeMonitor.tick("store")
        store.appendMessagePartDelta(this.sessionId, messageId, partId, text)
      }
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer()
    if (this.active) return
    this.idleTimer = setTimeout(() => {
      this.callbacks.onWorkerIdle(this.sessionId)
    }, IDLE_TIMEOUT_MS)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }
}

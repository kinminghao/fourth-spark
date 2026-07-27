import { useSessionStore } from "../stores/session-store"
import { dispatchSseEvent } from "./sse-events"

const IDLE_TIMEOUT_MS = 10 * 60 * 1000

export type WorkerPoolCallbacks = {
  onWorkerIdle: (sessionId: string) => void
}

export class SessionWorker {
  readonly sessionId: string
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private active = false
  private alive = true
  private callbacks: WorkerPoolCallbacks

  constructor(sessionId: string, callbacks: WorkerPoolCallbacks) {
    this.sessionId = sessionId
    this.callbacks = callbacks
    this.resetIdleTimer()
  }

  dispatch(eventName: string, data: unknown): void {
    if (!this.alive) return
    this.resetIdleTimer()
    const store = useSessionStore.getState()
    dispatchSseEvent(eventName, data, this.sessionId, store)
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
    void useSessionStore.getState().refreshSessionData(this.sessionId)
  }

  stop(): void {
    this.alive = false
    this.clearIdleTimer()
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

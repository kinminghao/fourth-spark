import * as api from "./api-client"
import { useSessionStore } from "../stores/session-store"

const POLL_MS = 60_000

type SupervisorCallbacks = {
  ensureWorker: (sessionId: string) => void
}

export class SessionSupervisor {
  private timer: ReturnType<typeof setInterval> | null = null
  private paused = false
  private repoId: string
  private callbacks: SupervisorCallbacks

  constructor(repoId: string, callbacks: SupervisorCallbacks) {
    this.repoId = repoId
    this.callbacks = callbacks
  }

  start(): void {
    this.tick()
    this.timer = setInterval(() => {
      if (!this.paused) this.tick()
    }, POLL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
    this.tick()
  }

  private tick(): void {
    const repoId = this.repoId

    void useSessionStore.getState().loadSessions(repoId)

    void api
      .getAllSessionStatuses(repoId)
      .then((statuses) => {
        const mapped: Record<string, string> = {}
        for (const [id, s] of Object.entries(statuses)) {
          mapped[id] = s.type ?? "idle"
        }
        useSessionStore.getState().bulkSetStatuses(mapped)

        for (const [id, status] of Object.entries(mapped)) {
          if (status === "busy" || status === "retry") {
            this.callbacks.ensureWorker(id)
          }
        }
      })
      .catch(() => {})
  }
}

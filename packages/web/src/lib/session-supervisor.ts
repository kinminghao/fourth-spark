import * as api from "./api-client"
import { useSessionStore } from "../stores/session-store"
import { useRepoStore } from "../stores/repo-store"

const POLL_MS = 60_000

type SupervisorCallbacks = {
  ensureWorker: (sessionId: string) => void
}

export class SessionSupervisor {
  private timer: ReturnType<typeof setInterval> | null = null
  private paused = false
  private callbacks: SupervisorCallbacks

  constructor(callbacks: SupervisorCallbacks) {
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
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) return

    void useSessionStore.getState().loadSessions()

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

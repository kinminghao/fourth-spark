import { SessionWorker, type WorkerPoolCallbacks } from "./session-worker"
import { GlobalEventDispatcher } from "./global-event-dispatcher"
import { SessionSupervisor } from "./session-supervisor"
import { useSessionStore } from "../stores/session-store"
import { freezeMonitor } from "./freeze-monitor"

class SessionOrchestrator {
  private workers = new Map<string, SessionWorker>()
  private dispatcher: GlobalEventDispatcher | null = null
  private supervisor: SessionSupervisor | null = null
  private visibilityHandler: (() => void) | null = null
  private repoId: string | null = null

  start(repoId: string): void {
    this.stop()
    this.repoId = repoId

    const poolCallbacks: WorkerPoolCallbacks = {
      onWorkerIdle: (sessionId) => this.removeWorker(sessionId),
      onSessionIdle: (sessionId) => {
        this.workers.get(sessionId)?.refreshOnIdle()
      },
    }

    this.dispatcher = new GlobalEventDispatcher(repoId, (sessionId, eventName, data) => {
      const worker = this.ensureWorker(sessionId, poolCallbacks)
      worker.dispatch(eventName, data)
    })
    this.dispatcher.start()

    this.supervisor = new SessionSupervisor(repoId, {
      ensureWorker: (sessionId) => this.ensureWorker(sessionId, poolCallbacks),
    })
    this.supervisor.start()

    this.visibilityHandler = () => {
      if (document.hidden) {
        this.supervisor?.pause()
      } else {
        this.supervisor?.resume()
      }
    }
    document.addEventListener("visibilitychange", this.visibilityHandler)
  }

  stop(): void {
    this.dispatcher?.stop()
    this.dispatcher = null
    this.supervisor?.stop()
    this.supervisor = null
    for (const worker of this.workers.values()) worker.stop()
    this.workers.clear()
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler)
      this.visibilityHandler = null
    }
  }

  activateSession(sessionId: string): void {
    for (const w of this.workers.values()) {
      if (w.sessionId !== sessionId) w.deactivate()
    }
    if (!sessionId) return
    const poolCallbacks: WorkerPoolCallbacks = {
      onWorkerIdle: (sid) => this.removeWorker(sid),
      onSessionIdle: (sid) => this.workers.get(sid)?.refreshOnIdle(),
    }
    const worker = this.ensureWorker(sessionId, poolCallbacks)
    worker.activate()
    if (this.repoId) void useSessionStore.getState().refreshSessionData(this.repoId, sessionId)
  }

  deactivateSession(sessionId: string): void {
    this.workers.get(sessionId)?.deactivate()
  }

  private ensureWorker(sessionId: string, callbacks: WorkerPoolCallbacks): SessionWorker {
    let worker = this.workers.get(sessionId)
    if (!worker) {
      worker = new SessionWorker(sessionId, this.repoId!, callbacks)
      this.workers.set(sessionId, worker)
      freezeMonitor.setGauge("workers", this.workers.size)
    }
    return worker
  }

  private removeWorker(sessionId: string): void {
    const active = useSessionStore.getState().activeSessionId
    if (sessionId === active) return
    const worker = this.workers.get(sessionId)
    if (worker) {
      worker.stop()
      this.workers.delete(sessionId)
      freezeMonitor.setGauge("workers", this.workers.size)
    }
  }
}

export const orchestrator = new SessionOrchestrator()

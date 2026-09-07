import { getApiBaseUrl } from "./config"
import { useSessionStore } from "../stores/session-store"
import { useToastStore } from "../stores/toast-store"

const RING_SIZE = 60
const FREEZE_THRESHOLD_MS = 3_000
const COOLDOWN_MS = 30_000
const SAMPLE_INTERVAL_MS = 1_000

interface SecondSample {
  ts: number
  sse: number
  delta: number
  storeSets: number
}

interface Gauges {
  workers: number
}

type TickCategory = "sse" | "delta" | "storeSet"

class FreezeMonitor {
  private ring: SecondSample[] = []
  private counters: Record<TickCategory, number> = { sse: 0, delta: 0, storeSet: 0 }
  private gauges: Gauges = { workers: 0 }
  private rafId = 0
  private sampleTimer = 0
  private lastFrameTs = 0
  private lastReportTs = 0
  private running = false

  tick(category: TickCategory): void {
    this.counters[category]++
  }

  setGauge(key: keyof Gauges, value: number): void {
    this.gauges[key] = value
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastFrameTs = performance.now()
    this.scheduleFrame()
    this.sampleTimer = window.setInterval(() => this.sample(), SAMPLE_INTERVAL_MS)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
    clearInterval(this.sampleTimer)
    this.ring.length = 0
  }

  private scheduleFrame(): void {
    this.rafId = requestAnimationFrame((now) => {
      if (!this.running) return
      const gap = now - this.lastFrameTs
      this.lastFrameTs = now

      if (gap >= FREEZE_THRESHOLD_MS && Date.now() - this.lastReportTs > COOLDOWN_MS) {
        this.lastReportTs = Date.now()
        this.report(Math.round(gap))
      }

      this.scheduleFrame()
    })
  }

  private sample(): void {
    const entry: SecondSample = {
      ts: Date.now(),
      sse: this.counters.sse,
      delta: this.counters.delta,
      storeSets: this.counters.storeSet,
    }
    this.counters.sse = 0
    this.counters.delta = 0
    this.counters.storeSet = 0

    this.ring.push(entry)
    if (this.ring.length > RING_SIZE) this.ring.shift()
  }

  private report(freezeDurationMs: number): void {
    const state = useSessionStore.getState()
    const messageCount = Object.values(state.messages)
      .reduce((sum, msgs) => sum + msgs.length, 0)

    const mem = (performance as any).memory as
      | { usedJSHeapSize: number; totalJSHeapSize: number }
      | undefined

    const payload = {
      userAgent: navigator.userAgent,
      url: location.href,
      freezeDurationMs,
      metrics: {
        timeline: [...this.ring],
        workerCount: this.gauges.workers,
        messageCount,
        sessionCount: state.sessions.length,
        heapUsedMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined,
        heapTotalMB: mem ? Math.round(mem.totalJSHeapSize / 1048576) : undefined,
      },
    }

    useToastStore.getState().addToast(
      `检测到页面卡顿 ${(freezeDurationMs / 1000).toFixed(1)}s，已自动上报`,
      "warning",
    )

    fetch(`${getApiBaseUrl()}/api/diagnostics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {})
  }
}

export const freezeMonitor = new FreezeMonitor()

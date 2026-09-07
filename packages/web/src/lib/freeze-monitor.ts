import { useSessionStore } from "../stores/session-store"

const SAMPLE_INTERVAL_MS = 1_000
const PERSIST_INTERVAL_MS = 5_000
const STORAGE_KEY = "freeze-mon-buffer"
const MAX_STORAGE_BYTES = 4 * 1024 * 1024

interface Sample {
  ts: number
  sse: number
  delta: number
  store: number
  workers: number
  msgs: number
  heap?: number
}

type TickCategory = "sse" | "delta" | "store"

class FreezeMonitor {
  private ring: Sample[] = []
  private counters: Record<TickCategory, number> = { sse: 0, delta: 0, store: 0 }
  private workerCount = 0
  private sampleTimer = 0
  private persistTimer = 0
  private running = false

  tick(category: TickCategory): void {
    this.counters[category]++
  }

  setGauge(key: "workers", value: number): void {
    if (key === "workers") this.workerCount = value
  }

  exportData(): string {
    return localStorage.getItem(STORAGE_KEY) ?? JSON.stringify(this.ring)
  }

  start(): void {
    if (this.running) return
    this.running = true

    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try { this.ring = JSON.parse(saved) } catch { this.ring = [] }
    }

    this.sampleTimer = window.setInterval(() => this.sample(), SAMPLE_INTERVAL_MS)
    this.persistTimer = window.setInterval(() => this.persist(), PERSIST_INTERVAL_MS)
  }

  stop(): void {
    this.running = false
    clearInterval(this.sampleTimer)
    clearInterval(this.persistTimer)
    this.persist()
  }

  private sample(): void {
    const state = useSessionStore.getState()
    const msgs = Object.values(state.messages).reduce((sum, m) => sum + m.length, 0)
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory

    this.ring.push({
      ts: Date.now(),
      sse: this.counters.sse,
      delta: this.counters.delta,
      store: this.counters.store,
      workers: this.workerCount,
      msgs,
      heap: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined,
    })
    this.counters.sse = 0
    this.counters.delta = 0
    this.counters.store = 0

    this.trimToFit()
  }

  private trimToFit(): void {
    while (this.ring.length > 1) {
      const size = new Blob([JSON.stringify(this.ring)]).size
      if (size <= MAX_STORAGE_BYTES) break
      this.ring.shift()
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ring))
    } catch {
      this.ring.splice(0, Math.floor(this.ring.length / 2))
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ring)) } catch {}
    }
  }
}

export const freezeMonitor = new FreezeMonitor()

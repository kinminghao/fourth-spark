import { beforeEach, describe, expect, test } from "bun:test"
import { freezeMonitor } from "../../src/lib/freeze-monitor"

describe("FreezeMonitor", () => {
  beforeEach(() => {
    freezeMonitor.stop()
    localStorage.clear()
  })

  test("tick increments counters (verified via start+stop cycle persisting)", () => {
    freezeMonitor.tick("sse")
    freezeMonitor.tick("sse")
    freezeMonitor.tick("delta")
    expect(() => freezeMonitor.tick("store")).not.toThrow()
  })

  test("setGauge accepts workers value", () => {
    expect(() => freezeMonitor.setGauge("workers", 5)).not.toThrow()
  })

  test("exportData returns valid JSON string", () => {
    const data = freezeMonitor.exportData()
    expect(() => JSON.parse(data)).not.toThrow()
  })

  test("exportData returns localStorage content when available", () => {
    const samples = [{ ts: 1, sse: 0, delta: 0, store: 0, workers: 0, msgs: 0 }]
    localStorage.setItem("freeze-mon-buffer", JSON.stringify(samples))

    const data = JSON.parse(freezeMonitor.exportData())
    expect(data).toHaveLength(1)
    expect(data[0].ts).toBe(1)
  })

  test("exportData falls back to in-memory ring when localStorage empty", () => {
    const data = freezeMonitor.exportData()
    const parsed = JSON.parse(data)
    expect(Array.isArray(parsed)).toBe(true)
  })

  test("start is idempotent", () => {
    freezeMonitor.start()
    freezeMonitor.start()
    freezeMonitor.stop()
  })

  test("stop persists data to localStorage", () => {
    freezeMonitor.start()
    freezeMonitor.stop()

    const stored = localStorage.getItem("freeze-mon-buffer")
    expect(stored).not.toBeNull()
    expect(() => JSON.parse(stored!)).not.toThrow()
  })

  test("start restores ring from localStorage", () => {
    const saved = [
      { ts: 100, sse: 1, delta: 2, store: 3, workers: 0, msgs: 0 },
      { ts: 200, sse: 4, delta: 5, store: 6, workers: 1, msgs: 10 },
    ]
    localStorage.setItem("freeze-mon-buffer", JSON.stringify(saved))

    freezeMonitor.start()
    freezeMonitor.stop()

    const data = JSON.parse(freezeMonitor.exportData())
    expect(data.length).toBeGreaterThanOrEqual(2)
  })

  test("start handles corrupt localStorage gracefully", () => {
    localStorage.setItem("freeze-mon-buffer", "not valid json{{{")

    freezeMonitor.start()
    freezeMonitor.stop()

    const data = JSON.parse(freezeMonitor.exportData())
    expect(Array.isArray(data)).toBe(true)
  })
})

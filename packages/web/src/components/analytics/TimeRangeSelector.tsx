import clsx from "clsx"
import { useState } from "react"
import { useAnalyticsStore } from "../../stores/analytics-store"

const DAY_MS = 24 * 60 * 60 * 1000

interface Preset {
  label: string
  compute: () => { from: number; to: number }
}

const PRESETS: Preset[] = [
  {
    label: "今天",
    compute: () => {
      const now = new Date()
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      return { from: midnight, to: Date.now() }
    },
  },
  {
    label: "7天",
    compute: () => {
      const to = Date.now()
      return { from: to - 7 * DAY_MS, to }
    },
  },
  {
    label: "30天",
    compute: () => {
      const to = Date.now()
      return { from: to - 30 * DAY_MS, to }
    },
  },
]

const RANGE_TOLERANCE_MS = 60_000

function isActivePreset(preset: Preset, range: { from: number; to: number }): boolean {
  const { from, to } = preset.compute()
  return Math.abs(from - range.from) < RANGE_TOLERANCE_MS && Math.abs(to - range.to) < RANGE_TOLERANCE_MS
}

function toDateStr(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function fromDateStr(s: string, endOfDay: boolean): number {
  const [y, m, d] = s.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  return endOfDay ? date.getTime() + DAY_MS - 1 : date.getTime()
}

export function TimeRangeSelector() {
  const timeRange = useAnalyticsStore((s) => s.timeRange)
  const setTimeRange = useAnalyticsStore((s) => s.setTimeRange)
  const [customOpen, setCustomOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState(() => toDateStr(timeRange.from))
  const [customTo, setCustomTo] = useState(() => toDateStr(timeRange.to))

  const anyPresetActive = PRESETS.some((p) => isActivePreset(p, timeRange))

  const applyCustom = () => {
    if (!customFrom || !customTo) return
    const from = fromDateStr(customFrom, false)
    const to = fromDateStr(customTo, true)
    if (from >= to) return
    void setTimeRange(from, to)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((preset) => {
        const active = isActivePreset(preset, timeRange)
        return (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              setCustomOpen(false)
              const { from, to } = preset.compute()
              void setTimeRange(from, to)
            }}
            className={clsx(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "border-blue-500 bg-blue-500/10 text-blue-600"
                : "border-line text-fg-3 hover:bg-elevated",
            )}
          >
            {preset.label}
          </button>
        )
      })}
      <button
        type="button"
        onClick={() => setCustomOpen((v) => !v)}
        className={clsx(
          "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
          customOpen && !anyPresetActive
            ? "border-blue-500 bg-blue-500/10 text-blue-600"
            : "border-line text-fg-3 hover:bg-elevated",
        )}
      >
        自定义
      </button>
      {customOpen && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-md border border-line bg-base px-2 py-1 text-xs text-fg focus:border-blue-500 focus:outline-none"
          />
          <span className="text-xs text-fg-4">—</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-md border border-line bg-base px-2 py-1 text-xs text-fg focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={applyCustom}
            className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500"
          >
            确定
          </button>
        </div>
      )}
    </div>
  )
}

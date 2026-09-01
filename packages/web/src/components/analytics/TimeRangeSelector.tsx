import clsx from "clsx"
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

export function TimeRangeSelector() {
  const timeRange = useAnalyticsStore((s) => s.timeRange)
  const setTimeRange = useAnalyticsStore((s) => s.setTimeRange)

  return (
    <div className="flex items-center gap-2">
      {PRESETS.map((preset) => {
        const active = isActivePreset(preset, timeRange)
        return (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
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
    </div>
  )
}

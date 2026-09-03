import { create } from "zustand"
import { fetchAnalyticsSummary, type AnalyticsResponse } from "../lib/api-client"

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_RANGE_DAYS = 7
const POLL_INTERVAL_MS = 30_000

function defaultRange(): { from: number; to: number } {
  const to = Date.now()
  const from = to - DEFAULT_RANGE_DAYS * DAY_MS
  return { from, to }
}

interface AnalyticsState {
  timeRange: { from: number; to: number }
  repoData: AnalyticsResponse | null
  dayData: AnalyticsResponse | null
  agentData: AnalyticsResponse | null
  loading: boolean
  loadAll: () => Promise<void>
  setTimeRange: (from: number, to: number) => Promise<void>
  startPolling: () => () => void
}

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
  timeRange: defaultRange(),
  repoData: null,
  dayData: null,
  agentData: null,
  loading: false,

  loadAll: async () => {
    const { from, to } = get().timeRange
    set({ loading: true })
    try {
      const [repoData, dayData, agentData] = await Promise.all([
        fetchAnalyticsSummary(from, to, "repo"),
        fetchAnalyticsSummary(from, to, "day"),
        fetchAnalyticsSummary(from, to, "agent"),
      ])
      set({ repoData, dayData, agentData, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  setTimeRange: async (from, to) => {
    set({ timeRange: { from, to } })
    await get().loadAll()
  },

  startPolling: () => {
    const id = setInterval(() => void get().loadAll(), POLL_INTERVAL_MS)
    return () => clearInterval(id)
  },
}))

import { useEffect, useRef } from "react"
import { BarChart3, Loader2 } from "lucide-react"
import { useAnalyticsStore } from "../stores/analytics-store"
import { useRepoStore } from "../stores/repo-store"
import { repoEventsUrl } from "../lib/api-client"
import { parseEventData } from "../lib/sse-events"
import { TimeRangeSelector } from "../components/analytics/TimeRangeSelector"
import { SummaryCards } from "../components/analytics/SummaryCards"
import { CostTrendChart } from "../components/analytics/CostTrendChart"
import { CostByRepoChart } from "../components/analytics/CostByRepoChart"
import { CostByAgentChart } from "../components/analytics/CostByAgentChart"

function useAnalyticsSse() {
  const repos = useRepoStore((s) => s.repos)
  const sourcesRef = useRef<EventSource[]>([])

  useEffect(() => {
    const sources: EventSource[] = []
    for (const repo of repos) {
      const source = new EventSource(repoEventsUrl(repo.id))
      source.addEventListener("session.updated", (event) => {
        const data = parseEventData((event as MessageEvent).data)
        if (!data || typeof data !== "object") return
        const props = (data as Record<string, unknown>).properties ?? data
        if (typeof (props as Record<string, unknown>).cost === "number" && (props as Record<string, unknown>).cost as number > 0) {
          useAnalyticsStore.getState().scheduleRefresh()
        }
      })
      sources.push(source)
    }
    sourcesRef.current = sources
    return () => sources.forEach((s) => s.close())
  }, [repos])
}

export function AnalyticsPage() {
  const loading = useAnalyticsStore((s) => s.loading)
  const repoData = useAnalyticsStore((s) => s.repoData)
  const dayData = useAnalyticsStore((s) => s.dayData)
  const agentData = useAnalyticsStore((s) => s.agentData)

  useEffect(() => {
    void useAnalyticsStore.getState().loadAll()
  }, [])

  useAnalyticsSse()

  const hasLoaded = repoData !== null && dayData !== null && agentData !== null
  const isEmpty =
    hasLoaded &&
    (repoData?.groups.length ?? 0) === 0 &&
    (dayData?.groups.length ?? 0) === 0 &&
    (agentData?.groups.length ?? 0) === 0

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold text-fg">统计</h1>
        <TimeRangeSelector />
      </div>

      {loading && !hasLoaded ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-fg-5" />
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center gap-2 py-16 text-fg-5">
          <BarChart3 className="h-8 w-8 text-fg-6" />
          <span className="text-sm">该时间范围内暂无消耗数据</span>
        </div>
      ) : (
        <>
          <SummaryCards />
          <CostTrendChart />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <CostByRepoChart />
            <CostByAgentChart />
          </div>
        </>
      )}
    </div>
  )
}

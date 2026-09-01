import { useEffect } from "react"
import { BarChart3, Loader2 } from "lucide-react"
import { useAnalyticsStore } from "../stores/analytics-store"
import { TimeRangeSelector } from "../components/analytics/TimeRangeSelector"
import { SummaryCards } from "../components/analytics/SummaryCards"
import { CostTrendChart } from "../components/analytics/CostTrendChart"
import { CostByRepoChart } from "../components/analytics/CostByRepoChart"
import { CostByAgentChart } from "../components/analytics/CostByAgentChart"

export function AnalyticsPage() {
  const loading = useAnalyticsStore((s) => s.loading)
  const repoData = useAnalyticsStore((s) => s.repoData)
  const dayData = useAnalyticsStore((s) => s.dayData)
  const agentData = useAnalyticsStore((s) => s.agentData)

  useEffect(() => {
    void useAnalyticsStore.getState().loadAll()
  }, [])

  const hasLoaded = repoData !== null && dayData !== null && agentData !== null
  const isEmpty =
    hasLoaded &&
    (repoData?.groups.length ?? 0) === 0 &&
    (dayData?.groups.length ?? 0) === 0 &&
    (agentData?.groups.length ?? 0) === 0

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
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

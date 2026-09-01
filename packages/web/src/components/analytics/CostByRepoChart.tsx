import { BarChart3 } from "lucide-react"
import { useMemo } from "react"
import { useAnalyticsStore } from "../../stores/analytics-store"
import { formatCost } from "../../lib/format"
import type { AnalyticsGroup } from "../../lib/api-client"

interface RepoRow {
  key: string
  label: string
  userCost: number
  systemCost: number
  total: number
}

function buildRows(groups: AnalyticsGroup[] | undefined): RepoRow[] {
  if (!groups || groups.length === 0) return []
  const byRepo = new Map<string, RepoRow>()
  for (const g of groups) {
    const key = g.repoId ?? g.label
    let row = byRepo.get(key)
    if (!row) {
      row = { key, label: g.label, userCost: 0, systemCost: 0, total: 0 }
      byRepo.set(key, row)
    }
    if (g.isSystem) row.systemCost += g.cost
    else row.userCost += g.cost
    row.total = row.userCost + row.systemCost
  }
  return Array.from(byRepo.values())
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
}

export function CostByRepoChart() {
  const repoData = useAnalyticsStore((s) => s.repoData)
  const rows = useMemo(() => buildRows(repoData?.groups), [repoData])
  const maxTotal = rows.reduce((m, r) => Math.max(m, r.total), 0)

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-fg-2">按仓库</h2>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-fg-5">
          <BarChart3 className="h-8 w-8 text-fg-6" />
          <span className="text-sm">该时间范围内暂无消耗数据</span>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {rows.map((row) => {
            const userPct = maxTotal > 0 ? `${(row.userCost / maxTotal) * 100}%` : "0%"
            const systemPct = maxTotal > 0 ? `${(row.systemCost / maxTotal) * 100}%` : "0%"
            return (
              <div key={row.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate text-fg-3">{row.label}</span>
                  <span className="ml-2 shrink-0 font-mono text-fg-4">{formatCost(row.total)}</span>
                </div>
                <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-elevated">
                  <div className="h-full rounded-l-full bg-blue-500" style={{ width: userPct }} />
                  <div className="h-full bg-amber-500" style={{ width: systemPct }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

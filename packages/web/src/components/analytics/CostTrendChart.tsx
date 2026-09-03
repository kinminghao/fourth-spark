import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useMemo } from "react"
import { useAnalyticsStore } from "../../stores/analytics-store"
import { formatCost } from "../../lib/format"
import type { AnalyticsGroup } from "../../lib/api-client"

interface TrendPoint {
  date: string
  userCost: number
  systemCost: number
}

function buildTrend(groups: AnalyticsGroup[] | undefined): TrendPoint[] {
  if (!groups || groups.length === 0) return []
  const byDate = new Map<string, TrendPoint>()
  for (const g of groups) {
    const date = g.date ?? g.label
    if (!date) continue
    let point = byDate.get(date)
    if (!point) {
      point = { date, userCost: 0, systemCost: 0 }
      byDate.set(date, point)
    }
    if (g.isSystem) point.systemCost += g.cost
    else point.userCost += g.cost
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

interface TooltipPayloadItem {
  dataKey?: string | number
  value?: number
  color?: string
}

interface TrendTooltipProps {
  active?: boolean
  label?: string | number
  payload?: TooltipPayloadItem[]
}

function TrendTooltip({ active, label, payload }: TrendTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const userItem = payload.find((p) => p.dataKey === "userCost")
  const systemItem = payload.find((p) => p.dataKey === "systemCost")
  const userCost = userItem?.value ?? 0
  const systemCost = systemItem?.value ?? 0
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-lg">
      <div className="text-[11px] font-medium text-fg-3">{label}</div>
      <div className="mt-1 flex items-center gap-1 text-[11px] text-fg-2">
        <span className="h-2 w-2 rounded-full bg-blue-500" />
        用户 <span className="font-mono">{formatCost(userCost)}</span>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-fg-2">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        系统 <span className="font-mono">{formatCost(systemCost)}</span>
      </div>
    </div>
  )
}

export function CostTrendChart() {
  const dayData = useAnalyticsStore((s) => s.dayData)
  const data = useMemo(() => buildTrend(dayData?.groups), [dayData])

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg-2">花费趋势</h2>
        <div className="flex items-center gap-3 text-[11px] text-fg-3">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            用户
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            系统
          </span>
        </div>
      </div>
      <div className="mt-3 h-[200px] md:h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--t-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--t-fg-4)" />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--t-fg-4)" tickFormatter={(v: number) => formatCost(v)} />
            <Tooltip content={<TrendTooltip />} cursor={{ fill: "var(--t-elevated)", opacity: 0.5 }} />
            <Bar dataKey="userCost" stackId="cost" fill="#3b82f6" radius={[0, 0, 0, 0]} />
            <Bar dataKey="systemCost" stackId="cost" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

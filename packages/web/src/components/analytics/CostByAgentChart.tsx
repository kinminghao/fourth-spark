import { BarChart3 } from "lucide-react"
import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useAnalyticsStore } from "../../stores/analytics-store"
import { formatCost } from "../../lib/format"
import type { AnalyticsGroup } from "../../lib/api-client"

interface AgentRow {
  label: string
  userCost: number
  systemCost: number
}

function agentKey(g: AnalyticsGroup): string {
  return `${g.agent ?? "unknown"}-${g.modelId ?? "unknown"}-${g.customAgentId ?? "none"}`
}

function buildRows(groups: AnalyticsGroup[] | undefined): AgentRow[] {
  if (!groups || groups.length === 0) return []
  const byAgent = new Map<string, AgentRow>()
  for (const g of groups) {
    const key = agentKey(g)
    let row = byAgent.get(key)
    if (!row) {
      row = { label: g.isSystem ? `${g.label} (系统)` : g.label, userCost: 0, systemCost: 0 }
      byAgent.set(key, row)
    }
    if (g.isSystem) row.systemCost += g.cost
    else row.userCost += g.cost
  }
  return Array.from(byAgent.values())
    .filter((r) => r.userCost + r.systemCost > 0)
    .sort((a, b) => (b.userCost + b.systemCost) - (a.userCost + a.systemCost))
}

interface BarTooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ dataKey?: string; value?: number }>
}

function AgentTooltip({ active, label, payload }: BarTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const userCost = payload.find((p) => p.dataKey === "userCost")?.value ?? 0
  const systemCost = payload.find((p) => p.dataKey === "systemCost")?.value ?? 0
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

export function CostByAgentChart() {
  const agentData = useAnalyticsStore((s) => s.agentData)
  const rows = useMemo(() => buildRows(agentData?.groups), [agentData])

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-fg-2">按 Agent</h2>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-fg-5">
          <BarChart3 className="h-8 w-8 text-fg-6" />
          <span className="text-sm">该时间范围内暂无消耗数据</span>
        </div>
      ) : (
        <div className="mt-3 h-[200px] md:h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--t-line)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--t-fg-4)" interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--t-fg-4)" tickFormatter={(v: number) => formatCost(v)} />
              <Tooltip content={<AgentTooltip />} cursor={{ fill: "var(--t-elevated)", opacity: 0.5 }} />
              <Bar dataKey="userCost" stackId="cost" fill="#3b82f6" radius={[0, 0, 0, 0]} />
              <Bar dataKey="systemCost" stackId="cost" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

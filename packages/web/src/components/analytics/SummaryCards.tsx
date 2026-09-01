import { DollarSign, MessageSquare, Zap } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useAnalyticsStore } from "../../stores/analytics-store"
import { formatCost, formatTokens } from "../../lib/format"
import type { AnalyticsGroup, AnalyticsSummary } from "../../lib/api-client"

interface Split {
  user: AnalyticsSummary
  system: AnalyticsSummary
}

const ZERO: AnalyticsSummary = {
  cost: 0,
  tokensInput: 0,
  tokensOutput: 0,
  tokensReasoning: 0,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  sessionCount: 0,
}

function splitBySystem(groups: AnalyticsGroup[] | undefined): Split {
  const user: AnalyticsSummary = { ...ZERO }
  const system: AnalyticsSummary = { ...ZERO }
  if (!groups) return { user, system }
  for (const g of groups) {
    const target = g.isSystem ? system : user
    target.cost += g.cost
    target.tokensInput += g.tokensInput
    target.tokensOutput += g.tokensOutput
    target.tokensReasoning += g.tokensReasoning
    target.tokensCacheRead += g.tokensCacheRead
    target.tokensCacheWrite += g.tokensCacheWrite
    target.sessionCount += g.sessionCount
  }
  return { user, system }
}

interface CardProps {
  icon: LucideIcon
  label: string
  main: string
  userValue: string
  systemValue: string
}

function Card({ icon: Icon, label, main, userValue, systemValue }: CardProps) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-fg-3">
        <Icon className="h-3.5 w-3.5 text-fg-4" />
        <span>{label}</span>
      </div>
      <div className="mt-2 font-mono text-2xl font-bold text-fg">{main}</div>
      <div className="mt-2 flex items-center gap-3 text-[11px]">
        <span className="flex items-center gap-1 text-fg-3">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          用户 <span className="font-mono text-fg-2">{userValue}</span>
        </span>
        <span className="flex items-center gap-1 text-fg-3">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          系统 <span className="font-mono text-fg-2">{systemValue}</span>
        </span>
      </div>
    </div>
  )
}

export function SummaryCards() {
  const repoData = useAnalyticsStore((s) => s.repoData)
  const { user, system } = splitBySystem(repoData?.groups)
  const total = repoData?.total

  const totalTokens = total ? total.tokensInput + total.tokensOutput : 0
  const userTokens = user.tokensInput + user.tokensOutput
  const systemTokens = system.tokensInput + system.tokensOutput

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card
        icon={DollarSign}
        label="总花费"
        main={formatCost(total?.cost ?? 0)}
        userValue={formatCost(user.cost)}
        systemValue={formatCost(system.cost)}
      />
      <Card
        icon={Zap}
        label="Token 用量"
        main={formatTokens(totalTokens)}
        userValue={formatTokens(userTokens)}
        systemValue={formatTokens(systemTokens)}
      />
      <Card
        icon={MessageSquare}
        label="会话数"
        main={String(total?.sessionCount ?? 0)}
        userValue={String(user.sessionCount)}
        systemValue={String(system.sessionCount)}
      />
    </div>
  )
}

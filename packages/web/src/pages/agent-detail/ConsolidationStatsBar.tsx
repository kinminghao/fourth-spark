import type { ConsolidationStats } from "../../lib/api-client"
import { formatRelativeTime } from "./agent-utils"

export const CONSOLIDATION_INTERVAL_MS = 4 * 60 * 60 * 1_000

export function formatNextRun(lastConsolidatedAt: number | null): string {
  if (!lastConsolidatedAt) return "下次：待定"
  const nextRun = lastConsolidatedAt + CONSOLIDATION_INTERVAL_MS
  const now = Date.now()
  if (nextRun <= now) return "下次：即将运行"
  const diff = nextRun - now
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `下次：约 ${mins} 分钟后`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `下次：约 ${hours} 小时后`
  return `下次：约 ${Math.floor(hours / 24)} 天后`
}

export function ConsolidationStatsBar({ stats, running, onTrigger }: {
  stats: ConsolidationStats | null
  running: boolean
  onTrigger: () => void
}) {
  if (!stats) return null

  const a = stats.lastActions

  return (
    <div className="rounded-lg bg-elevated px-3 py-2 text-[11px] tabular-nums text-fg-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          {stats.lastConsolidatedAt
            ? `上次整理：${formatRelativeTime(stats.lastConsolidatedAt)}`
            : "尚未整理"}
        </span>
        <span className="text-fg-6">·</span>
        <span>{formatNextRun(stats.lastConsolidatedAt)}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onTrigger}
          disabled={running}
          className="rounded px-2 py-0.5 text-[10px] font-medium text-fg-4 transition-colors hover:bg-surface hover:text-fg-3 disabled:opacity-40"
        >
          {running ? "整理中…" : "立即整理"}
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {a && (
          <>
            <span>{a.update} 更新 {a.merge} 合并 {a.delete} 清理 {a.decayed} 降权</span>
            <span className="text-fg-6">·</span>
          </>
        )}
        <span>活跃 {stats.totalActive} 条</span>
        <span className="text-fg-6">·</span>
        <span>衰减中 {stats.stale}</span>
      </div>
    </div>
  )
}

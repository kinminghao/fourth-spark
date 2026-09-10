import type { UsageResult } from "../../lib/api-client"

export const usageCache: { data: UsageResult; fetchedAt: number } = { data: null as any, fetchedAt: 0 }

export function formatElapsed(ts: number): string {
  const ms = Date.now() - ts
  const m = Math.floor(ms / 60_000)
  if (m < 1) return "刚刚"
  if (m < 60) return `${m} 分钟前`
  return `${Math.floor(m / 60)} 小时前`
}

export function formatReset(resetsAt: string | undefined): string | null {
  if (!resetsAt) return null
  const diff = new Date(resetsAt).getTime() - Date.now()
  if (diff <= 0) return "已重置"
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m 后重置`
  return `${m}m 后重置`
}

export function barColor(pct: number): string {
  if (pct >= 90) return "bg-red-500"
  if (pct >= 70) return "bg-amber-500"
  return "bg-blue-500"
}

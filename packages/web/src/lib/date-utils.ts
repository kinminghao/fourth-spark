/* ------------------------------------------------------------------ */
/*  Shared date/time formatting helpers                                */
/* ------------------------------------------------------------------ */

export function relativeTime(ts: number): string {
  const ms = ts < 1_000_000_000_000 ? ts * 1000 : ts
  const diff = Date.now() - ms
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)}天前`
  const d = new Date(ms)
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
}

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  return (
    d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  )
}

export function prStateColor(state: string): string {
  if (state === "merged") return "bg-purple-500/15 text-purple-400"
  if (state === "closed") return "bg-red-500/15 text-red-400"
  return "bg-emerald-500/15 text-emerald-400"
}

export function issueStateColor(state: string): string {
  return state === "open"
    ? "bg-emerald-500/15 text-emerald-400"
    : "bg-purple-500/15 text-purple-400"
}

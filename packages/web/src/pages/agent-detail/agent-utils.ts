import { AGENT_AVATAR_PALETTE, agentAvatar } from "../../lib/agent-avatar"

// Static class strings so Tailwind can pick them up.
export const CATEGORY_PALETTE = [
  { bg: "bg-blue-500/10", text: "text-blue-400" },
  { bg: "bg-amber-500/10", text: "text-amber-400" },
  { bg: "bg-green-500/10", text: "text-green-400" },
  { bg: "bg-purple-500/10", text: "text-purple-400" },
  { bg: "bg-cyan-500/10", text: "text-cyan-400" },
  { bg: "bg-rose-500/10", text: "text-rose-400" },
  { bg: "bg-indigo-500/10", text: "text-indigo-400" },
  { bg: "bg-orange-500/10", text: "text-orange-400" },
] as const

export const CATEGORY_STYLE_GENERAL = { bg: "bg-elevated", text: "text-fg-4" } as const

export function getCategoryStyle(category: string): { bg: string; text: string } {
  if (category === "general") return CATEGORY_STYLE_GENERAL
  let hash = 0
  for (let i = 0; i < category.length; i++) hash = ((hash << 5) - hash + category.charCodeAt(i)) | 0
  return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length]
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "刚刚"
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
}

export const VERSION_ACTION_LABELS: Record<string, { label: string; color: string }> = {
  create: { label: "首次提取", color: "text-green-400" },
  update: { label: "重写", color: "text-blue-400" },
  merge: { label: "合并", color: "text-purple-400" },
  decay: { label: "衰减", color: "text-amber-400" },
  reinforce: { label: "强化", color: "text-emerald-400" },
  manual: { label: "手动编辑", color: "text-fg-3" },
}

export const BASE_AGENTS = ["Sisyphus - ultraworker", "Prometheus - Plan Builder", "Atlas - Plan Executor"]
export const PINNED_MODELS_KEY = "pinned_models"
export const SP_KEY = "__system_prompt__"

export { AGENT_AVATAR_PALETTE, agentAvatar }

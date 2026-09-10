// Deterministic initial-letter avatar. Static class strings so Tailwind can pick them up.
export const AGENT_AVATAR_PALETTE = [
  { bg: "bg-blue-500/15", text: "text-blue-500" },
  { bg: "bg-purple-500/15", text: "text-purple-500" },
  { bg: "bg-emerald-500/15", text: "text-emerald-500" },
  { bg: "bg-amber-500/15", text: "text-amber-500" },
  { bg: "bg-rose-500/15", text: "text-rose-500" },
  { bg: "bg-cyan-500/15", text: "text-cyan-500" },
  { bg: "bg-indigo-500/15", text: "text-indigo-500" },
  { bg: "bg-orange-500/15", text: "text-orange-500" },
] as const

export function agentAvatar(name: string): { bg: string; text: string; initial: string } {
  const trimmed = name.trim()
  const code = trimmed.charCodeAt(0) || 0
  const palette = AGENT_AVATAR_PALETTE[code % AGENT_AVATAR_PALETTE.length]
  return { ...palette, initial: (trimmed.charAt(0) || "?").toUpperCase() }
}

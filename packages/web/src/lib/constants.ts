// ---------------------------------------------------------------------------
// Pagination & data-loading
// ---------------------------------------------------------------------------
export const PAGE_SIZE = 50
export const MESSAGES_PAGE_SIZE = 20
export const SESSIONS_LOAD_LIMIT = 200
export const ISSUES_LOAD_LIMIT = 1_000

// ---------------------------------------------------------------------------
// Content display limits
// ---------------------------------------------------------------------------
export const OUTPUT_TRUNCATE_LIMIT = 2_000
export const CONTENT_PREVIEW_LIMIT = 500
export const TEXT_FOLD_LINE_THRESHOLD = 5
export const TEXT_FOLD_CHAR_THRESHOLD = 500

// ---------------------------------------------------------------------------
// Attachment constraints
// ---------------------------------------------------------------------------
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_ATTACHMENTS = 10

// ---------------------------------------------------------------------------
// Timing (ms)
// ---------------------------------------------------------------------------
export const TOAST_DURATION_MS = 4_000
export const TOAST_EXIT_MS = 300
export const HIGHLIGHT_DURATION_MS = 2_000
export const COPY_FEEDBACK_MS = 2_000
export const SCROLL_DELAY_MS = 300
export const DEBOUNCE_MS = 300
export const DEBOUNCE_SLOW_MS = 500
export const POLL_INTERVAL_MS = 2_000
export const VERSION_CHECK_INTERVAL_MS = 30 * 60_000

// ---------------------------------------------------------------------------
// Avatar palette
// ---------------------------------------------------------------------------

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

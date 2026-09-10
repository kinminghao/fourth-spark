import type { Message } from "../../lib/api-client"
import type { TodoStatus } from "../../lib/message-parts"

export const MARK: Record<TodoStatus, { glyph: string; color: string; spin: boolean }> = {
  completed: { glyph: "✓", color: "text-emerald-400", spin: false },
  in_progress: { glyph: "◌", color: "text-amber-400", spin: true },
  cancelled: { glyph: "✗", color: "text-fg-5", spin: false },
  pending: { glyph: "○", color: "text-fg-4", spin: false },
}

export type Tab = "todo" | "prompts" | "links" | "subtasks"

export function formatTime(msg: Message): string {
  const raw = msg.time?.created
  if (!raw) return ""
  const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw
  const date = new Date(ms)
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

export function getTextPreview(msg: Message): string {
  if (!msg.parts) return ""
  for (const part of msg.parts) {
    const text = part.content ?? part.text
    if (text) return text
  }
  return ""
}

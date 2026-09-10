import type { Message as ApiMessage } from "../../lib/api-client"
import { formatTokens, formatCost } from "../../lib/format"

export const STATUS_META: Record<
  string,
  { glyph: string; label: string; color: string; spin: boolean }
> = {
  idle: { glyph: "●", label: "ready", color: "text-emerald-400", spin: false },
  busy: { glyph: "◌", label: "running", color: "text-amber-400", spin: true },
  retry: { glyph: "◌", label: "retrying", color: "text-amber-400", spin: true },
  error: { glyph: "✗", label: "error", color: "text-red-400", spin: false },
}

export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-opus-4": 1_000_000,
  "claude-sonnet-4": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "claude-opus-5": 1_000_000,
  "claude-3-7-sonnet": 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3-5-haiku": 200_000,
  "claude-3-opus": 200_000,
  "claude-3-sonnet": 200_000,
  "claude-3-haiku": 200_000,
}

export const DEFAULT_CONTEXT_LIMIT = 1_000_000

export function getContextLimit(modelID?: string): number {
  if (!modelID) return DEFAULT_CONTEXT_LIMIT
  for (const [prefix, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (modelID.startsWith(prefix)) return limit
  }
  return DEFAULT_CONTEXT_LIMIT
}

export function getLastAssistantTokens(messages: readonly ApiMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "assistant" && m.tokens) {
      const t = m.tokens
      if (t.cache && (t.cache.read > 0 || t.cache.write > 0)) return t
      if (t.input > 0 || t.output > 0) return t
    }
  }
  return null
}

import { z } from "zod"
import type { PromptFile } from "../../core/runtime-types"

// ---------------------------------------------------------------------------
// Request body schemas
// ---------------------------------------------------------------------------

export const CreateSessionBody = z.object({
  message: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  variant: z.string().optional(),
  title: z.string().optional(),
  issueId: z.string().optional(),
  customAgentId: z.string().optional(),
  files: z.array(z.object({
    mime: z.string(),
    url: z.string(),
    filename: z.string().optional(),
  })).optional(),
})

export const SessionPromptBody = z.object({
  content: z.string(),
  agent: z.string().optional(),
  model: z.string().optional(),
  variant: z.string().optional(),
  files: z.array(z.object({
    mime: z.string(),
    url: z.string(),
    filename: z.string().optional(),
  })).optional(),
})

export const SessionRevertBody = z.object({
  messageID: z.string().min(1),
  partID: z.string().optional(),
})

export const QuestionReplyBody = z.object({
  answers: z.array(z.array(z.string())),
})

export const UpdateSessionBody = z.object({
  issueId: z.string().nullable().optional(),
  title: z.string().optional(),
  completedAt: z.number().nullable().optional(),
  pinnedAt: z.number().nullable().optional(),
})

export const SessionLinkBody = z.object({
  type: z.enum(["issue", "pr"]),
  targetId: z.string().min(1),
})

// ---------------------------------------------------------------------------
// PromptFile server-side validation
// ---------------------------------------------------------------------------

export const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
export const MAX_FILE_COUNT = 10
// 5 MB raw ≈ 6.87 MB base64 (×1.37 overhead). We check the data-URL string length.
export const MAX_DATA_URL_LENGTH = 7 * 1024 * 1024

export function validateFiles(raw: unknown): PromptFile[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  if (raw.length > MAX_FILE_COUNT) {
    throw new Error(`Too many files: ${raw.length} (max ${MAX_FILE_COUNT})`)
  }
  const out: PromptFile[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      throw new Error("Each file must be an object with mime and url")
    }
    const { mime, url, filename } = item as Record<string, unknown>
    if (typeof mime !== "string" || !ALLOWED_MIME_TYPES.has(mime)) {
      throw new Error(`Unsupported mime type: ${String(mime)}. Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`)
    }
    if (typeof url !== "string" || !url.startsWith("data:")) {
      throw new Error("File url must be a data: URL")
    }
    if (url.length > MAX_DATA_URL_LENGTH) {
      throw new Error(`File too large (max ~5 MB). ${typeof filename === "string" ? filename : ""}`)
    }
    out.push({ mime, url, filename: typeof filename === "string" ? filename : undefined })
  }
  return out
}

import { describe, expect, test } from "bun:test"
import {
  EXTRACTION_CLAIM_LEASE_MS,
  EXTRACTION_MAX_ATTEMPTS,
  EXTRACTION_RETRY_BACKOFF_MS,
  type ExtractionCandidate,
  MAX_CONSOLIDATION_CONTENT_LENGTH,
  isExtractionDue,
  isStaleBacklog,
  normalizeCategory,
  parseExtractionOutput,
  parseExtractionResult,
  processExtractionOutput,
  sanitizeMemoryContent,
  validateMemoryContent,
} from "../../../src/lib/memory-extractor"

describe("sanitizeMemoryContent", () => {
  test("passes clean content through", () => {
    expect(sanitizeMemoryContent("clean content")).toBe("clean content")
  })

  test("truncates to maxLength", () => {
    const long = "a".repeat(300)
    const result = sanitizeMemoryContent(long)
    expect(result.length).toBe(200) // default MAX_EXTRACTION_CONTENT_LENGTH
  })

  test("truncates to custom maxLength", () => {
    const long = "a".repeat(100)
    const result = sanitizeMemoryContent(long, 50)
    expect(result.length).toBe(50)
  })

  test("strips AGENT MEMORY sentinel patterns", () => {
    expect(sanitizeMemoryContent("[AGENT MEMORY] some content")).toBe(" some content")
    expect(sanitizeMemoryContent("[/AGENT MEMORY] trailing")).toBe(" trailing")
  })

  test("strips system: prefix patterns", () => {
    expect(sanitizeMemoryContent("system: do something")).toBe(" do something")
  })
})

describe("validateMemoryContent", () => {
  test("accepts valid content", () => {
    const result = validateMemoryContent("This is valid memory content")
    expect(result).toEqual({ ok: true })
  })

  test("rejects content that is too long", () => {
    const result = validateMemoryContent("a".repeat(201))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("too long")
  })

  test("rejects content that is too short", () => {
    const result = validateMemoryContent("abc")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("too short")
  })

  test("accepts content with custom maxLength", () => {
    const result = validateMemoryContent("a".repeat(500), { maxLength: MAX_CONSOLIDATION_CONTENT_LENGTH })
    expect(result).toEqual({ ok: true })
  })

  test("rejects content with PR/Issue numbers", () => {
    const result = validateMemoryContent("Fixed issue #123 in the codebase")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("PR/Issue")
  })

  test("rejects content with file extensions", () => {
    const result = validateMemoryContent("Changed the logic in parser.ts")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("file extension")
  })

  test("rejects content with code blocks", () => {
    const result = validateMemoryContent("Use this pattern:\n```\ncode\n```")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("code block")
  })

  test("rejects content with hash-like tokens", () => {
    const result = validateMemoryContent("Commit abc1234def was the root cause")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("hash-like")
  })

  test("skips forbidden patterns when option set", () => {
    const result = validateMemoryContent("Fixed issue #123 in parser.ts", { skipForbiddenPatterns: true })
    expect(result).toEqual({ ok: true })
  })
})

describe("normalizeCategory", () => {
  test("trims and returns valid string", () => {
    expect(normalizeCategory("  debugging  ")).toBe("debugging")
  })

  test("returns 'general' for empty string", () => {
    expect(normalizeCategory("")).toBe("general")
    expect(normalizeCategory("   ")).toBe("general")
  })

  test("returns 'general' for non-string", () => {
    expect(normalizeCategory(null)).toBe("general")
    expect(normalizeCategory(undefined)).toBe("general")
    expect(normalizeCategory(42)).toBe("general")
  })

  test("preserves valid category", () => {
    expect(normalizeCategory("architecture")).toBe("architecture")
  })
})

const DAY_MS = 86_400_000

function makeCandidate(overrides: Partial<ExtractionCandidate> = {}): ExtractionCandidate {
  return {
    id: "sess-1",
    customAgentId: "agent-1",
    timeUpdated: 1_000,
    lastExtractionAt: null,
    extractionAttempts: 0,
    extractionRetryAt: null,
    latestMemoryAt: null,
    ...overrides,
  }
}

describe("isExtractionDue", () => {
  const now = 100_000

  test("fresh session with no cursor is due", () => {
    expect(isExtractionDue(makeCandidate(), now)).toBe(true)
  })

  test("same version with no pending retry is not due", () => {
    const candidate = makeCandidate({ timeUpdated: 1_000, lastExtractionAt: 1_000 })
    expect(isExtractionDue(candidate, now)).toBe(false)
  })

  test("newer content past the watermark is due", () => {
    const candidate = makeCandidate({ timeUpdated: 2_000, lastExtractionAt: 1_000 })
    expect(isExtractionDue(candidate, now)).toBe(true)
  })

  test("active lease in the future blocks even new content", () => {
    const candidate = makeCandidate({ timeUpdated: 2_000, lastExtractionAt: 1_000, extractionRetryAt: now + 1_000 })
    expect(isExtractionDue(candidate, now)).toBe(false)
  })

  test("retry is due once the backoff gate opens", () => {
    const candidate = makeCandidate({
      timeUpdated: 1_000,
      lastExtractionAt: 1_000,
      extractionAttempts: 1,
      extractionRetryAt: now - 1,
    })
    expect(isExtractionDue(candidate, now)).toBe(true)
  })

  test("exhausted attempts with same version is not due", () => {
    const candidate = makeCandidate({
      timeUpdated: 1_000,
      lastExtractionAt: 1_000,
      extractionAttempts: EXTRACTION_MAX_ATTEMPTS,
      extractionRetryAt: now - 1,
    })
    expect(isExtractionDue(candidate, now)).toBe(false)
  })

  test("exhausted attempts with new content is due", () => {
    const candidate = makeCandidate({
      timeUpdated: 2_000,
      lastExtractionAt: 1_000,
      extractionAttempts: EXTRACTION_MAX_ATTEMPTS,
      extractionRetryAt: now - 1,
    })
    expect(isExtractionDue(candidate, now)).toBe(true)
  })

  test("legacy bootstrap uses latest memory as watermark", () => {
    const atWatermark = makeCandidate({ timeUpdated: 1_000, latestMemoryAt: 1_000 })
    expect(isExtractionDue(atWatermark, now)).toBe(false)

    const pastWatermark = makeCandidate({ timeUpdated: 2_000, latestMemoryAt: 1_000 })
    expect(isExtractionDue(pastWatermark, now)).toBe(true)
  })
})

describe("isStaleBacklog", () => {
  const now = 10 * DAY_MS

  test("unseen session older than the threshold is stale", () => {
    const candidate = makeCandidate({ timeUpdated: now - 8 * DAY_MS })
    expect(isStaleBacklog(candidate, now)).toBe(true)
  })

  test("unseen session within the threshold is not stale", () => {
    const candidate = makeCandidate({ timeUpdated: now - 6 * DAY_MS })
    expect(isStaleBacklog(candidate, now)).toBe(false)
  })

  test("session with memory is not stale", () => {
    const candidate = makeCandidate({ timeUpdated: now - 8 * DAY_MS, latestMemoryAt: now - 8 * DAY_MS })
    expect(isStaleBacklog(candidate, now)).toBe(false)
  })

  test("session already extracted is not stale", () => {
    const candidate = makeCandidate({ timeUpdated: now - 8 * DAY_MS, lastExtractionAt: now - 8 * DAY_MS })
    expect(isStaleBacklog(candidate, now)).toBe(false)
  })
})

describe("parseExtractionOutput", () => {
  test("empty array parses to zero actions", () => {
    expect(parseExtractionOutput("[]")).toEqual({
      kind: "parsed",
      actions: [],
      rawCount: 0,
      rejectedCount: 0,
    })
  })

  test("valid add action parses", () => {
    const text = JSON.stringify([
      { action: "add", content: "Prefers concise and direct answers", category: "general", importance: 0.5 },
    ])
    const output = parseExtractionOutput(text)
    expect(output.kind).toBe("parsed")
    if (output.kind === "parsed") {
      expect(output.rawCount).toBe(1)
      expect(output.rejectedCount).toBe(0)
      expect(output.actions).toHaveLength(1)
      expect(output.actions[0]?.action).toBe("add")
    }
  })

  test("garbage output is invalid", () => {
    const output = parseExtractionOutput("this is not json at all")
    expect(output.kind).toBe("invalid")
  })

  test("action rejected by validation is counted but dropped", () => {
    const output = parseExtractionOutput('[{"action":"add"}]')
    expect(output.kind).toBe("parsed")
    if (output.kind === "parsed") {
      expect(output.actions).toHaveLength(0)
      expect(output.rawCount).toBe(1)
      expect(output.rejectedCount).toBe(1)
    }
  })

  test("fenced json block parses", () => {
    const text = '```json\n[{"action":"add","content":"Uses bun test runner","category":"general","importance":0.5}]\n```'
    const output = parseExtractionOutput(text)
    expect(output.kind).toBe("parsed")
    if (output.kind === "parsed") {
      expect(output.rawCount).toBe(1)
      expect(output.actions).toHaveLength(1)
    }
  })
})

describe("parseExtractionResult", () => {
  test("returns empty array for garbage", () => {
    expect(parseExtractionResult("definitely not json")).toEqual([])
  })

  test("returns actions for valid input", () => {
    const text = JSON.stringify([
      { action: "add", content: "Keeps changes focused and small", category: "general", importance: 0.5 },
    ])
    const actions = parseExtractionResult(text)
    expect(actions).toHaveLength(1)
    expect(actions[0]?.action).toBe("add")
  })
})

describe("processExtractionOutput classification", () => {
  test("missing output file is a failure", async () => {
    const outcome = await processExtractionOutput("agent-1", "ses-1", null)
    expect(outcome.kind).toBe("failed")
    if (outcome.kind === "failed") expect(outcome.error).toContain("missing")
  })

  test("empty and whitespace-only output are failures", async () => {
    const empty = await processExtractionOutput("agent-1", "ses-1", "")
    expect(empty.kind).toBe("failed")
    const blank = await processExtractionOutput("agent-1", "ses-1", "   ")
    expect(blank.kind).toBe("failed")
  })

  test("unparseable output is a failure", async () => {
    const outcome = await processExtractionOutput("agent-1", "ses-1", "not json")
    expect(outcome.kind).toBe("failed")
    if (outcome.kind === "failed") expect(outcome.error).toBe("unparseable output")
  })

  test("empty array completes with zero actions", async () => {
    const outcome = await processExtractionOutput("agent-1", "ses-1", "[]")
    expect(outcome).toEqual({ kind: "completed", actionCount: 0, rawCount: 0, rejectedCount: 0, applied: 0 })
  })
})

describe("extraction cursor constants", () => {
  test("backoff schedule covers every retryable attempt", () => {
    expect(EXTRACTION_RETRY_BACKOFF_MS.length).toBeGreaterThanOrEqual(EXTRACTION_MAX_ATTEMPTS - 1)
  })

  test("claim lease is longer than ten minutes", () => {
    expect(EXTRACTION_CLAIM_LEASE_MS).toBeGreaterThan(10 * 60 * 1_000)
  })
})

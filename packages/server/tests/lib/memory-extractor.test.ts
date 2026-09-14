import { describe, expect, test } from "bun:test"
import {
  sanitizeMemoryContent,
  validateMemoryContent,
  normalizeCategory,
  MAX_CONSOLIDATION_CONTENT_LENGTH,
} from "../../src/lib/memory-extractor"

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
    const result = validateMemoryContent(
      "a".repeat(500),
      { maxLength: MAX_CONSOLIDATION_CONTENT_LENGTH },
    )
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
    const result = validateMemoryContent(
      "Fixed issue #123 in parser.ts",
      { skipForbiddenPatterns: true },
    )
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

import { describe, expect, test } from "bun:test"
import { sanitizeForPg, num, str } from "../../../src/db/sync"

describe("sanitizeForPg", () => {
  test("passes clean strings through", () => {
    expect(sanitizeForPg("hello world")).toBe("hello world")
  })

  test("strips NULL bytes from strings", () => {
    expect(sanitizeForPg("hello\u0000world")).toBe("helloworld")
    expect(sanitizeForPg("\u0000")).toBe("")
  })

  test("strips lone high surrogates", () => {
    // \uD800 without a following low surrogate
    const input = "before\uD800after"
    const result = sanitizeForPg(input) as string
    expect(result).not.toContain("\uD800")
    expect(result).toContain("before")
    expect(result).toContain("after")
  })

  test("preserves valid surrogate pairs (emoji)", () => {
    // 😀 is \uD83D\uDE00 — a valid surrogate pair
    expect(sanitizeForPg("hello 😀")).toBe("hello 😀")
  })

  test("recurses into arrays", () => {
    expect(sanitizeForPg(["a\u0000b", "c"])).toEqual(["ab", "c"])
  })

  test("recurses into objects", () => {
    expect(sanitizeForPg({ key: "val\u0000ue", n: 42 }))
      .toEqual({ key: "value", n: 42 })
  })

  test("recurses into nested structures", () => {
    const input = { a: [{ b: "x\u0000y" }], c: "clean" }
    expect(sanitizeForPg(input)).toEqual({ a: [{ b: "xy" }], c: "clean" })
  })

  test("passes numbers through", () => {
    expect(sanitizeForPg(42)).toBe(42)
  })

  test("passes booleans through", () => {
    expect(sanitizeForPg(true)).toBe(true)
  })

  test("passes null through", () => {
    expect(sanitizeForPg(null)).toBeNull()
  })

  test("passes undefined through", () => {
    expect(sanitizeForPg(undefined)).toBeUndefined()
  })
})

describe("num", () => {
  test("returns number as-is", () => {
    expect(num(42)).toBe(42)
  })

  test("returns fallback for non-number", () => {
    expect(num("not a number")).toBe(0)
    expect(num(null)).toBe(0)
    expect(num(undefined)).toBe(0)
  })

  test("uses custom fallback", () => {
    expect(num("nope", 99)).toBe(99)
  })

  test("clamps negative to 0", () => {
    expect(num(-5)).toBe(0)
  })

  test("returns fallback for NaN", () => {
    expect(num(NaN)).toBe(0)
  })

  test("returns fallback for Infinity", () => {
    expect(num(Infinity)).toBe(0)
    expect(num(-Infinity)).toBe(0)
  })

  test("passes zero through", () => {
    expect(num(0)).toBe(0)
  })
})

describe("str", () => {
  test("returns string as-is", () => {
    expect(str("hello")).toBe("hello")
  })

  test("returns fallback for non-string", () => {
    expect(str(42)).toBe("")
    expect(str(null)).toBe("")
    expect(str(undefined)).toBe("")
    expect(str(true)).toBe("")
  })

  test("uses custom fallback", () => {
    expect(str(null, "default")).toBe("default")
  })

  test("returns empty string as-is", () => {
    expect(str("")).toBe("")
  })
})

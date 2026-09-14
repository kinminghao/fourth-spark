import { describe, expect, test } from "bun:test"
import { formatTokens, formatCost } from "../../src/lib/format"

describe("formatTokens", () => {
  test("millions", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M")
    expect(formatTokens(2_500_000)).toBe("2.5M")
    expect(formatTokens(10_000_000)).toBe("10.0M")
  })

  test("thousands", () => {
    expect(formatTokens(1_000)).toBe("1.0k")
    expect(formatTokens(1_500)).toBe("1.5k")
    expect(formatTokens(999_999)).toBe("1000.0k")
  })

  test("below thousand", () => {
    expect(formatTokens(0)).toBe("0")
    expect(formatTokens(1)).toBe("1")
    expect(formatTokens(999)).toBe("999")
  })
})

describe("formatCost", () => {
  test("dollars (>= 1)", () => {
    expect(formatCost(1)).toBe("$1.00")
    expect(formatCost(12.345)).toBe("$12.35")
    expect(formatCost(100)).toBe("$100.00")
  })

  test("cents (>= 0.01)", () => {
    expect(formatCost(0.01)).toBe("$0.010")
    expect(formatCost(0.123)).toBe("$0.123")
    expect(formatCost(0.999)).toBe("$0.999")
  })

  test("sub-cent (> 0)", () => {
    expect(formatCost(0.001)).toBe("$0.0010")
    expect(formatCost(0.0001)).toBe("$0.0001")
    expect(formatCost(0.009)).toBe("$0.0090")
  })

  test("zero", () => {
    expect(formatCost(0)).toBe("$0")
  })
})

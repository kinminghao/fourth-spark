import { describe, expect, test } from "bun:test"
import { prStateColor, issueStateColor } from "../../src/lib/date-utils"

describe("prStateColor", () => {
  test("merged → purple", () => {
    expect(prStateColor("merged")).toContain("purple")
  })

  test("closed → red", () => {
    expect(prStateColor("closed")).toContain("red")
  })

  test("open → emerald (default)", () => {
    expect(prStateColor("open")).toContain("emerald")
  })

  test("unknown state → emerald (default)", () => {
    expect(prStateColor("draft")).toContain("emerald")
  })
})

describe("issueStateColor", () => {
  test("open → emerald", () => {
    expect(issueStateColor("open")).toContain("emerald")
  })

  test("closed → purple", () => {
    expect(issueStateColor("closed")).toContain("purple")
  })
})

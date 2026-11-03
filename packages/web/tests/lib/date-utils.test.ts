import { describe, expect, test } from "bun:test"
import { issueStateColor, prStateColor, relativeTime } from "../../src/lib/date-utils"

const NOW = Date.now()

describe("relativeTime", () => {
  test("within a minute → 刚刚", () => {
    expect(relativeTime(NOW - 30_000)).toBe("刚刚")
  })

  test("minutes ago", () => {
    expect(relativeTime(NOW - 5 * 60_000)).toBe("5分钟前")
  })

  test("hours ago", () => {
    expect(relativeTime(NOW - 2 * 3_600_000)).toBe("2小时前")
  })

  test("days ago", () => {
    expect(relativeTime(NOW - 3 * 86_400_000)).toBe("3天前")
  })

  test("accepts epoch seconds", () => {
    expect(relativeTime(Math.floor((NOW - 5 * 60_000) / 1000))).toBe("5分钟前")
  })

  test("beyond a month → localized date", () => {
    const date = new Date(NOW - 40 * 86_400_000)
    expect(relativeTime(date.getTime())).toBe(date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" }))
  })
})

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

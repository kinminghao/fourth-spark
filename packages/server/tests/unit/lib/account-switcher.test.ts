import { describe, expect, test } from "bun:test"
import { isUsageLimit, parseResetMsFromMessage } from "../../../src/lib/account-switcher"

describe("isUsageLimit", () => {
  test("returns false for undefined/empty", () => {
    expect(isUsageLimit()).toBe(false)
    expect(isUsageLimit("")).toBe(false)
  })

  test("detects 'rate limit'", () => {
    expect(isUsageLimit("You hit the rate limit")).toBe(true)
  })

  test("detects 'usage limit'", () => {
    expect(isUsageLimit("usage limit reached")).toBe(true)
  })

  test("detects 'too many requests'", () => {
    expect(isUsageLimit("Error: too many requests")).toBe(true)
  })

  test("detects 'out of usage'", () => {
    expect(isUsageLimit("You are out of usage")).toBe(true)
  })

  test("detects 'out of quota'", () => {
    expect(isUsageLimit("out of quota")).toBe(true)
  })

  test("detects '5 hour' / '5-hour'", () => {
    expect(isUsageLimit("wait 5 hour")).toBe(true)
    expect(isUsageLimit("5-hour cooldown")).toBe(true)
  })

  test("detects 'weekly limit'", () => {
    expect(isUsageLimit("weekly limit exceeded")).toBe(true)
  })

  test("detects 'exceed'", () => {
    expect(isUsageLimit("You exceed the allowed threshold")).toBe(true)
  })

  test("case insensitive", () => {
    expect(isUsageLimit("RATE LIMIT")).toBe(true)
    expect(isUsageLimit("Rate Limit")).toBe(true)
  })

  test("returns false for overloaded_error (not a rate limit)", () => {
    expect(isUsageLimit("overloaded_error")).toBe(false)
    expect(isUsageLimit("got overloaded_error from API")).toBe(false)
  })

  test("returns false for unrelated errors", () => {
    expect(isUsageLimit("connection timeout")).toBe(false)
    expect(isUsageLimit("invalid API key")).toBe(false)
    expect(isUsageLimit("internal server error")).toBe(false)
  })
})

describe("parseResetMsFromMessage", () => {
  test("returns undefined for undefined/empty", () => {
    expect(parseResetMsFromMessage()).toBeUndefined()
    expect(parseResetMsFromMessage("")).toBeUndefined()
  })

  test("parses hours (English)", () => {
    const before = Date.now()
    const result = parseResetMsFromMessage("Please wait 5 hours")!
    expect(result).toBeGreaterThanOrEqual(before + 5 * 3600_000)
    expect(result).toBeLessThanOrEqual(Date.now() + 5 * 3600_000)
  })

  test("parses hours (Chinese)", () => {
    const before = Date.now()
    const result = parseResetMsFromMessage("请等待 3 小时")!
    expect(result).toBeGreaterThanOrEqual(before + 3 * 3600_000)
  })

  test("parses 'h' abbreviation", () => {
    const before = Date.now()
    const result = parseResetMsFromMessage("retry in 2h")!
    expect(result).toBeGreaterThanOrEqual(before + 2 * 3600_000)
  })

  test("parses minutes (English)", () => {
    const before = Date.now()
    const result = parseResetMsFromMessage("wait 30 minutes")!
    expect(result).toBeGreaterThanOrEqual(before + 30 * 60_000)
  })

  test("parses minutes (Chinese)", () => {
    const before = Date.now()
    const result = parseResetMsFromMessage("等待 15 分钟")!
    expect(result).toBeGreaterThanOrEqual(before + 15 * 60_000)
  })

  test("parses 'min' abbreviation", () => {
    const before = Date.now()
    const result = parseResetMsFromMessage("cooldown 10min")!
    expect(result).toBeGreaterThanOrEqual(before + 10 * 60_000)
  })

  test("hours take precedence over minutes", () => {
    const before = Date.now()
    const result = parseResetMsFromMessage("wait 2 hours and 30 minutes")!
    expect(result).toBeGreaterThanOrEqual(before + 2 * 3600_000)
  })

  test("returns undefined for no duration", () => {
    expect(parseResetMsFromMessage("rate limit reached")).toBeUndefined()
  })
})

import { describe, expect, test } from "bun:test"
import {
  parsePagination,
  paginatedResponse,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from "../../src/lib/pagination"

describe("parsePagination", () => {
  test("defaults when no params", () => {
    expect(parsePagination({})).toEqual({ limit: DEFAULT_LIMIT, offset: 0 })
  })

  test("parses valid limit and offset", () => {
    expect(parsePagination({ limit: "10", offset: "20" }))
      .toEqual({ limit: 10, offset: 20 })
  })

  test("clamps limit to MAX_LIMIT", () => {
    expect(parsePagination({ limit: "9999" }))
      .toEqual({ limit: MAX_LIMIT, offset: 0 })
  })

  test("clamps limit below 1 to default", () => {
    expect(parsePagination({ limit: "0" }))
      .toEqual({ limit: DEFAULT_LIMIT, offset: 0 })
    expect(parsePagination({ limit: "-5" }))
      .toEqual({ limit: DEFAULT_LIMIT, offset: 0 })
  })

  test("clamps negative offset to 0", () => {
    expect(parsePagination({ offset: "-10" }))
      .toEqual({ limit: DEFAULT_LIMIT, offset: 0 })
  })

  test("handles NaN limit", () => {
    expect(parsePagination({ limit: "abc" }))
      .toEqual({ limit: DEFAULT_LIMIT, offset: 0 })
  })

  test("handles NaN offset", () => {
    expect(parsePagination({ offset: "xyz" }))
      .toEqual({ limit: DEFAULT_LIMIT, offset: 0 })
  })

  test("handles Infinity", () => {
    expect(parsePagination({ limit: "Infinity" }))
      .toEqual({ limit: DEFAULT_LIMIT, offset: 0 })
  })

  test("handles undefined values", () => {
    expect(parsePagination({ limit: undefined, offset: undefined }))
      .toEqual({ limit: DEFAULT_LIMIT, offset: 0 })
  })
})

describe("paginatedResponse", () => {
  test("builds correct response shape", () => {
    const items = ["a", "b", "c"]
    const result = paginatedResponse(items, 100, { limit: 10, offset: 20 })
    expect(result).toEqual({
      items: ["a", "b", "c"],
      total: 100,
      limit: 10,
      offset: 20,
    })
  })

  test("empty items", () => {
    const result = paginatedResponse([], 0, { limit: 50, offset: 0 })
    expect(result).toEqual({ items: [], total: 0, limit: 50, offset: 0 })
  })
})

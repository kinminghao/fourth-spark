import { describe, expect, test } from "bun:test"
import { onError } from "../../../src/middleware/errors"
import { RuntimeError } from "../../../src/core/runtime-types"
import type { Context } from "hono"

// onError doesn't use the Context parameter (it's prefixed with _c)
const dummyCtx = {} as Context

describe("onError", () => {
  test("RuntimeError → matching status + JSON body", async () => {
    const err = new RuntimeError("repo-1", "rate limited", 429, "too many requests")
    const res = onError(err, dummyCtx)

    expect(res.status).toBe(429)
    expect(res.headers.get("Content-Type")).toBe("application/json")

    const body = await res.json() as { error: string }
    expect(body.error).toBe("rate limited")
  })

  test("RuntimeError with out-of-range status → clamps to 502", async () => {
    const err = new RuntimeError("repo-1", "bad status", 999, "body")
    const res = onError(err, dummyCtx)
    expect(res.status).toBe(502)
  })

  test("RuntimeError with status below 400 → clamps to 502", async () => {
    const err = new RuntimeError("repo-1", "redirect?", 301, "body")
    const res = onError(err, dummyCtx)
    expect(res.status).toBe(502)
  })

  test("RuntimeError with status 400 → passes through", async () => {
    const err = new RuntimeError("repo-1", "bad request", 400, "body")
    const res = onError(err, dummyCtx)
    expect(res.status).toBe(400)
  })

  test("RuntimeError with status 599 → passes through", async () => {
    const err = new RuntimeError("repo-1", "edge case", 599, "body")
    const res = onError(err, dummyCtx)
    expect(res.status).toBe(599)
  })

  test("unknown Error → 500 + JSON body", async () => {
    const err = new Error("something broke")
    const res = onError(err, dummyCtx)

    expect(res.status).toBe(500)
    const body = await res.json() as { error: string }
    expect(body.error).toBe("something broke")
  })

  test("Error without message → fallback message", async () => {
    const err = new Error()
    const res = onError(err, dummyCtx)

    expect(res.status).toBe(500)
    const body = await res.json() as { error: string }
    expect(body.error).toBe("Internal Server Error")
  })

  test("Error with cause → still returns 500", async () => {
    const cause = new Error("root cause")
    const err = new Error("wrapper", { cause })
    const res = onError(err, dummyCtx)

    expect(res.status).toBe(500)
    const body = await res.json() as { error: string }
    expect(body.error).toBe("wrapper")
  })
})

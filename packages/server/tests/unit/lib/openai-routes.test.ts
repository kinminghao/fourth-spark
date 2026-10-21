import { beforeEach, describe, expect, test } from "bun:test"
import { initWorkerConfig } from "../../../src/lib/config"
import { usageRoutes } from "../../../src/routes/usage"

function postAuthorize(body: unknown): Promise<Response> {
  return usageRoutes.request("/oauth/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("OpenAI OAuth account routes", () => {
  beforeEach(async () => {
    delete process.env.MASTER_URL
    delete process.env.WORKER_ID
    await initWorkerConfig(async () => undefined)
  })

  test("rejects an unregistered provider", async () => {
    const res = await postAuthorize({ provider: "nope" })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "unknown account provider: nope" })
  })

  test("rejects a provider without browser OAuth", async () => {
    const res = await postAuthorize({ provider: "anthropic" })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "provider anthropic does not support browser oauth" })
  })

  test("validates the provider on the poll endpoint", async () => {
    const res = await usageRoutes.request("/oauth/nope/logins/pending-1")
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "unknown account provider: nope" })
  })

  test("returns 404 for an unknown login handle", async () => {
    const res = await usageRoutes.request("/oauth/openai/logins/does-not-exist")
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "unknown login session" })
  })

  test("cancelling an unknown login handle is a no-op", async () => {
    const res = await usageRoutes.request("/oauth/openai/logins/does-not-exist", { method: "DELETE" })
    expect(res.status).toBe(204)
  })
})

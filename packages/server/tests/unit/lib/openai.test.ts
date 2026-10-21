import { describe, expect, test } from "bun:test"
import { isOpenAiTokenStale, refreshOpenAiToken } from "../../../src/lib/account-providers/openai"

const TOKEN_URL = "https://auth.openai.com/oauth/token"
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const MINUTE = 60_000

type CapturedRequest = {
  url: string
  method?: string
  contentType: string | null
  body: URLSearchParams
}

// The provider talks to the public OpenAI token endpoint; every test swaps the
// global fetch for a local stub and restores it in `finally`.
function installFetch(response: () => Response, requests: CapturedRequest[]): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const headers = new Headers(init?.headers)
    requests.push({
      url,
      method: init?.method,
      contentType: headers.get("content-type"),
      body: new URLSearchParams(typeof init?.body === "string" ? init.body : ""),
    })
    return response()
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function fakeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "none" })}.${b64url(payload)}.sig`
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

describe("isOpenAiTokenStale", () => {
  test("treats a missing access token or expiry as stale", () => {
    expect(isOpenAiTokenStale({})).toBe(true)
    expect(isOpenAiTokenStale({ access: "access" })).toBe(true)
    expect(isOpenAiTokenStale({ expires: Date.now() + 10 * MINUTE })).toBe(true)
  })

  test("treats an expiry inside the five minute buffer as stale", () => {
    expect(isOpenAiTokenStale({ access: "access", expires: Date.now() + 4 * MINUTE })).toBe(true)
  })

  test("accepts an expiry with ten minutes left", () => {
    expect(isOpenAiTokenStale({ access: "access", expires: Date.now() + 10 * MINUTE })).toBe(false)
  })
})

describe("refreshOpenAiToken", () => {
  test("posts the refresh grant and returns the rotated token with its account id", async () => {
    const requests: CapturedRequest[] = []
    const restore = installFetch(
      () =>
        jsonResponse({
          access_token: "access-new",
          refresh_token: "refresh-new",
          expires_in: 3600,
          id_token: fakeJwt({
            email: "one@example.com",
            chatgpt_account_id: "acct-one",
            organizations: [{ id: "org-one" }],
          }),
        }),
      requests,
    )
    try {
      const before = Date.now()
      const result = await refreshOpenAiToken("refresh-old")

      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe(TOKEN_URL)
      expect(requests[0].method).toBe("POST")
      expect(requests[0].contentType).toBe("application/x-www-form-urlencoded")
      expect(requests[0].body.get("grant_type")).toBe("refresh_token")
      expect(requests[0].body.get("refresh_token")).toBe("refresh-old")
      expect(requests[0].body.get("client_id")).toBe(CLIENT_ID)

      expect(result.access).toBe("access-new")
      expect(result.refresh).toBe("refresh-new")
      expect(result.accountId).toBe("acct-one")
      expect(result.expires).toBeGreaterThanOrEqual(before + 3600_000)
      expect(result.expires).toBeLessThanOrEqual(Date.now() + 3600_000)
    } finally {
      restore()
    }
  })

  test("keeps the previous refresh token when the response omits a rotated one", async () => {
    const requests: CapturedRequest[] = []
    const restore = installFetch(
      () =>
        jsonResponse({
          access_token: "access-kept",
          expires_in: 60,
          id_token: fakeJwt({ chatgpt_account_id: "acct-one" }),
        }),
      requests,
    )
    try {
      const result = await refreshOpenAiToken("refresh-old")
      expect(result.access).toBe("access-kept")
      expect(result.refresh).toBe("refresh-old")
      expect(result.accountId).toBe("acct-one")
    } finally {
      restore()
    }
  })

  test("throws on a non-2xx token response", async () => {
    const requests: CapturedRequest[] = []
    const restore = installFetch(() => new Response("denied", { status: 401 }), requests)
    try {
      await expect(refreshOpenAiToken("refresh-old")).rejects.toThrow("token refresh failed (HTTP 401)")
    } finally {
      restore()
    }
  })
})

import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { corsMiddleware } from "../../src/middleware/cors"

// Build a minimal app with CORS middleware + a test route
function createApp() {
  const app = new Hono()
  app.use("*", corsMiddleware)
  app.get("/test", (c) => c.json({ ok: true }))
  return app
}

describe("corsMiddleware", () => {
  const app = createApp()

  test("allows default frontend origin", async () => {
    const res = await app.request("/test", {
      headers: { Origin: "http://localhost:5173" },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173")
  })

  test("allows Capacitor iOS origin", async () => {
    const res = await app.request("/test", {
      headers: { Origin: "capacitor://localhost" },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost")
  })

  test("unknown origin falls back to FRONTEND_ORIGIN", async () => {
    const res = await app.request("/test", {
      headers: { Origin: "https://evil.com" },
    })
    expect(res.status).toBe(200)
    // Falls back to FRONTEND_ORIGIN, not the unknown origin
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173")
  })

  test("preflight OPTIONS returns allowed methods", async () => {
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
      },
    })
    const allowMethods = res.headers.get("Access-Control-Allow-Methods") ?? ""
    expect(allowMethods).toContain("GET")
    expect(allowMethods).toContain("POST")
    expect(allowMethods).toContain("DELETE")
    expect(allowMethods).toContain("PATCH")
  })

  test("preflight OPTIONS returns allowed headers including SSE headers", async () => {
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Content-Type",
      },
    })
    const allowHeaders = res.headers.get("Access-Control-Allow-Headers") ?? ""
    expect(allowHeaders).toContain("Content-Type")
    expect(allowHeaders).toContain("Cache-Control")
    expect(allowHeaders).toContain("Last-Event-ID")
  })

  test("credentials are allowed", async () => {
    const res = await app.request("/test", {
      headers: { Origin: "http://localhost:5173" },
    })
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true")
  })
})

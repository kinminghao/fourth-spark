// ---------------------------------------------------------------------------
// Auth middleware — validates Bearer token on all /api/* routes except whitelist
//
// Token sources (checked in order):
//   1. Authorization: Bearer <token>
//   2. ?token=<token> query parameter (required for SSE / EventSource)
//
// Whitelisted paths bypass auth entirely:
//   - /api/health           (monitoring)
//   - /api/doc, /api/doc.json (API reference)
//   - /api/auth/pair/*      (pairing flow — has its own gate via isPairWindowOpen)
//   - /api/auth/token       (manual token input — validates token itself)
//   - /api/auth/status      (public — tells client if auth is required)
//   - OPTIONS *             (CORS preflight)
//   - /* non-/api/ paths    (static assets, SPA)
// ---------------------------------------------------------------------------

import type { MiddlewareHandler } from "hono"
import { verifyToken, touchDevice, hasAnyDevices } from "../lib/auth"

const AUTH_WHITELIST = new Set([
  "/api/health",
  "/api/doc",
  "/api/doc.json",
  "/api/auth/pair/complete",
  "/api/auth/pair/status",
  "/api/auth/token",
  "/api/auth/status",
])

function extractToken(c: { req: { header(name: string): string | undefined; query(name: string): string | undefined } }): string | null {
  // 1. Authorization header
  const authHeader = c.req.header("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }

  // 2. Query parameter (SSE connections)
  const queryToken = c.req.query("token")
  if (queryToken) {
    return queryToken
  }

  return null
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const path = c.req.path
  const method = c.req.method

  // OPTIONS requests (CORS preflight) always pass — browsers don't attach auth headers
  if (method === "OPTIONS") {
    return next()
  }

  // Non-API paths (static assets, SPA) always pass
  if (!path.startsWith("/api/")) {
    return next()
  }

  // Whitelisted API paths
  if (AUTH_WHITELIST.has(path)) {
    return next()
  }

  // If no devices registered yet, skip auth (first-run bootstrap)
  if (!hasAnyDevices()) {
    return next()
  }

  const token = extractToken(c)
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401)
  }

  const deviceId = verifyToken(token)
  if (!deviceId) {
    return c.json({ error: "Unauthorized" }, 401)
  }

  // Attach device ID to context for downstream use
  c.set("deviceId", deviceId)

  // Update last-seen timestamp (fire-and-forget, non-blocking)
  touchDevice(deviceId).catch(() => {})

  return next()
}

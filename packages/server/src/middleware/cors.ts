import { cors } from "hono/cors"
import { FRONTEND_ORIGIN, EXTRA_ORIGINS } from "../lib/config"

// All origins the server accepts: the primary frontend, Capacitor iOS, and
// any extras from the EXTRA_ORIGINS env var.
const ALLOWED_ORIGINS = new Set([
  FRONTEND_ORIGIN,
  "capacitor://localhost", // Capacitor iOS WebView
  ...EXTRA_ORIGINS,
])

// Allow the Vite dev frontend and Capacitor iOS app to call this backend.
// Includes the headers browsers send for SSE (Accept, Cache-Control, Last-Event-ID).
export const corsMiddleware = cors({
  origin: (origin) => (ALLOWED_ORIGINS.has(origin) ? origin : FRONTEND_ORIGIN),
  allowMethods: ["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "Accept", "Cache-Control", "Last-Event-ID"],
  exposeHeaders: ["Content-Type"],
  credentials: true,
})

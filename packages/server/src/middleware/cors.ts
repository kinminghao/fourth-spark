import { cors } from "hono/cors"
import { FRONTEND_ORIGIN } from "../lib/config"

// Allow the Vite dev frontend to call this backend directly. Includes the
// headers browsers send for SSE (Accept, Cache-Control, Last-Event-ID).
export const corsMiddleware = cors({
  origin: FRONTEND_ORIGIN,
  allowMethods: ["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "Accept", "Cache-Control", "Last-Event-ID"],
  exposeHeaders: ["Content-Type"],
  credentials: true,
})

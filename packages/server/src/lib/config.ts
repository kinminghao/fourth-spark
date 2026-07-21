const DEFAULT_OPENCODE_URL = "http://localhost:8080"
const DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173"
const DEFAULT_PORT = 3000

// URL of the OpenCode `serve` process this backend proxies to.
export const OPENCODE_URL = process.env.OPENCODE_URL ?? DEFAULT_OPENCODE_URL

// Workspace directory forwarded as the `directory` query param on every
// OpenCode call. OpenCode scopes sessions/agents/events to this directory.
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? process.cwd()

// Port this backend listens on (frontend + Vite dev proxy target).
export const PORT = Number(process.env.PORT ?? DEFAULT_PORT)

// Allowed browser origin for CORS (the Vite dev server).
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? DEFAULT_FRONTEND_ORIGIN

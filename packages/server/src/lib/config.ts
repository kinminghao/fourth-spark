const DEFAULT_OPENCODE_URL = "http://localhost:8080"
const DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173"
const DEFAULT_PORT = 3000

// URL of the OpenCode `serve` process this backend proxies to.
export const OPENCODE_URL = process.env.OPENCODE_URL ?? DEFAULT_OPENCODE_URL

// Workspace directory forwarded as the `directory` query param on every
// OpenCode call. Resolve to git root so the agent sees the full monorepo,
// not just packages/server/ where Bun workspace runs the script.
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR
  ?? (Bun.spawnSync(["git", "rev-parse", "--show-toplevel"]).stdout.toString().trim() || process.cwd())

// Port this backend listens on (frontend + Vite dev proxy target).
export const PORT = Number(process.env.PORT ?? DEFAULT_PORT)

// Allowed browser origin for CORS (the Vite dev server).
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? DEFAULT_FRONTEND_ORIGIN

// Default model variant passed to prompt_async when the frontend doesn't specify one.
// The built-in web UI sends "max"; omitting it may cause a different default.
export const DEFAULT_VARIANT = process.env.DEFAULT_VARIANT ?? "max"

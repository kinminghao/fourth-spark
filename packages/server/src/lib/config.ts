const DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173"
const DEFAULT_PORT = 3000

// Port this backend listens on.
export const PORT = Number(process.env.PORT ?? DEFAULT_PORT)

// Allowed browser origin for CORS (the Vite dev server).
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? DEFAULT_FRONTEND_ORIGIN

// Default model variant passed to prompt_async when the frontend doesn't specify one.
// The built-in web UI sends "max"; omitting it may cause a different default.
export const DEFAULT_VARIANT = process.env.DEFAULT_VARIANT ?? "max"

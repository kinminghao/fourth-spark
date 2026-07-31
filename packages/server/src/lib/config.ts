export const APP_VERSION = process.env.APP_VERSION ?? (() => {
  try {
    return require("child_process").execSync("git rev-parse --short HEAD", { stdio: "pipe" }).toString().trim()
  } catch {
    return "dev"
  }
})()

const DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173"
const DEFAULT_PORT = 3000

// Port this backend listens on.
export const PORT = Number(process.env.PORT ?? DEFAULT_PORT)

// Allowed browser origin for CORS (the Vite dev server).
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? DEFAULT_FRONTEND_ORIGIN

// Extra origins allowed by CORS (comma-separated).
// Capacitor iOS uses "capacitor://localhost" — added automatically.
// Use this for additional origins such as a staging frontend.
export const EXTRA_ORIGINS: string[] = (process.env.EXTRA_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

// Default model variant passed to prompt_async when the frontend doesn't specify one.
// The built-in web UI sends "max"; omitting it may cause a different default.
export const DEFAULT_VARIANT = process.env.DEFAULT_VARIANT ?? "max"

// ---------------------------------------------------------------------------
// APNs (Apple Push Notification service)
// ---------------------------------------------------------------------------
// Required for iOS push notifications. All values come from Apple Developer portal.
// Leave unset to silently skip push — the server still runs without them.
export const APNS_KEY_ID = process.env.APNS_KEY_ID ?? ""
export const APNS_TEAM_ID = process.env.APNS_TEAM_ID ?? ""
export const APNS_KEY_PATH = process.env.APNS_KEY_PATH ?? ""
export const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID ?? "com.fourthspark.app"
export const APNS_PRODUCTION = process.env.APNS_PRODUCTION === "true"

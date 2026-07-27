/*
 * Runtime configuration for API connectivity.
 *
 * In browser (Vite dev server): returns "" so all fetch calls use relative
 * paths like "/api/…" which Vite proxies to the backend.
 *
 * In Capacitor (iOS native shell): returns the user-configured server URL
 * (e.g. "http://192.168.1.100:3000") so fetch calls become absolute.
 */

const STORAGE_KEY = "fourth-spark-server-url"

/**
 * Detect if running inside Capacitor's native WebView.
 * The native bridge injects `window.Capacitor` before any JS runs.
 */
export function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false
  const w = window as unknown as Record<string, unknown>
  const cap = w.Capacitor as { isNativePlatform?: () => boolean } | undefined
  return typeof cap?.isNativePlatform === "function" && cap.isNativePlatform()
}

/**
 * Return the base URL to prepend to all API paths.
 *
 * - Browser: `""` → fetch("/api/repos") (relative, Vite proxy handles it)
 * - Capacitor: `"http://192.168.1.100:3000"` → fetch("http://…/api/repos")
 */
export function getApiBaseUrl(): string {
  return localStorage.getItem(STORAGE_KEY) ?? ""
}

/** Persist a server URL (strips trailing slashes). */
export function setServerUrl(url: string): void {
  const normalized = url.replace(/\/+$/, "")
  if (normalized) {
    localStorage.setItem(STORAGE_KEY, normalized)
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

/** Read the currently stored server URL (may be empty). */
export function getServerUrl(): string {
  return localStorage.getItem(STORAGE_KEY) ?? ""
}

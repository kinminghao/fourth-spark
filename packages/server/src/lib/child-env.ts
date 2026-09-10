// ---------------------------------------------------------------------------
// Child-process environment filter — blocklist approach.
//
// Strips fourth-spark server-internal env vars before passing the environment
// to child processes (opencode serve, claude -p, etc.). Everything else is
// forwarded so that AI SDK provider keys, proxy settings, XDG paths, and
// system essentials reach the subprocess without maintaining a brittle
// whitelist.
// ---------------------------------------------------------------------------

const SERVER_INTERNAL_ENV = new Set([
  // Database
  "DATABASE_URL",
  // Server ports & networking (PORT is typically overridden per-child)
  "HTTPS_PORT",
  "FRONTEND_ORIGIN",
  "EXTRA_ORIGINS",
  // TLS
  "TLS_CERT",
  "TLS_KEY",
  // Git platform credentials (child uses MCP, not direct tokens)
  "GITEA_TOKEN",
  // Server identity & clustering
  "APP_VERSION",
  "STATIC_DIR",
  "DEFAULT_VARIANT",
  "MASTER_URL",
  "WORKER_ID",
  // Server logging (child has its own --log-level flag)
  "LOG_LEVEL",
  "LOG_PRETTY",
  // Server-specific debug/feature flags
  "CONSOLIDATION_DRY_RUN",
  "MEMORY_DEBUG",
  // Server model/migration paths
  "SENSEVOICE_DIR",
  "HF_MIRROR",
  "MIGRATIONS_DIR",
])

/**
 * Build a filtered copy of `process.env` for child processes, stripping
 * server-internal variables and applying explicit overrides.
 */
export function childEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !SERVER_INTERNAL_ENV.has(k)) {
      env[k] = v
    }
  }
  return { ...env, ...overrides }
}

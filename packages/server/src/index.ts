import { Hono } from "hono"
import { corsMiddleware } from "./middleware/cors"
import { requestLogger, logger } from "./middleware/logger"
import { onError } from "./middleware/errors"
import { sessions } from "./routes/sessions"
import { events, globalEvents } from "./routes/events"
import { agents } from "./routes/agents"
import { issueRoutes } from "./routes/issues"
import { settingsRoutes } from "./routes/settings"
import { gitHostRoutes } from "./routes/git-hosts"
import { health, repoHealth } from "./routes/health"
import { repoRoutes } from "./routes/repos"
import { usageRoutes } from "./routes/usage"
import { globalAgentsMd, repoAgentsMd } from "./routes/agents-md"
import { globalCustomAgents, repoCustomAgents } from "./routes/custom-agents"
import { globalFragments, repoFragments } from "./routes/prompt-fragments"
import { modelRoutes } from "./routes/models"
import { mcpRoute } from "./routes/mcp"
import { tagRoutes } from "./routes/tags"
import { pushRoutes } from "./routes/push"
import { PORT } from "./lib/config"
import { processManager } from "./lib/process-manager"
import { runMigrations } from "./db/migrate"
import { resolve, join } from "node:path"
import { existsSync } from "node:fs"
import "./db/index"

const app = new Hono()

app.use("*", corsMiddleware)
app.use("*", requestLogger)
app.onError(onError)

// ---------------------------------------------------------------------------
// Global routes
// ---------------------------------------------------------------------------
app.route("/api/repos", repoRoutes)
app.route("/api/settings", settingsRoutes)
app.route("/api/git-hosts", gitHostRoutes)
app.route("/api/health", health)
app.route("/api/usage", usageRoutes)
app.route("/api/push", pushRoutes)
app.route("/api/agents-md", globalAgentsMd)
app.route("/api/custom-agents", globalCustomAgents)
app.route("/api/prompt-fragments", globalFragments)
app.route("/api/repos", repoAgentsMd)

// ---------------------------------------------------------------------------
// Per-repo routes — all nested under /api/repos/:repoId/
// ---------------------------------------------------------------------------
const repoScoped = new Hono()

// Sessions + events share the sessions base path (events owns /:id/events).
repoScoped.route("/sessions", sessions)
repoScoped.route("/sessions", events)
repoScoped.route("/events", globalEvents)
repoScoped.route("/agents", agents)
repoScoped.route("/custom-agents", repoCustomAgents)
repoScoped.route("/prompt-fragments", repoFragments)
repoScoped.route("/models", modelRoutes)
repoScoped.route("/issues", issueRoutes)
repoScoped.route("/tags", tagRoutes)
repoScoped.route("/issues", tagRoutes)
repoScoped.route("/mcp", mcpRoute)
repoScoped.route("/health", repoHealth)

app.route("/api/repos/:repoId", repoScoped)

// ---------------------------------------------------------------------------
// Static file serving (production build)
// ---------------------------------------------------------------------------
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? "./public")

if (existsSync(join(STATIC_DIR, "index.html"))) {
  logger.info({ dir: STATIC_DIR }, "serving static frontend")

  app.get("*", async (c) => {
    const urlPath = new URL(c.req.url).pathname
    const filePath = resolve(join(STATIC_DIR, urlPath))

    // Prevent path traversal
    if (!filePath.startsWith(STATIC_DIR)) {
      return c.notFound()
    }

    const file = Bun.file(filePath)
    if (await file.exists()) {
      const headers: Record<string, string> = {}
      if (urlPath.startsWith("/assets/")) {
        headers["Cache-Control"] = "public, max-age=31536000, immutable"
      }
      return new Response(file, { headers })
    }

    // SPA fallback — return index.html for client-side routing
    return new Response(Bun.file(join(STATIC_DIR, "index.html")), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    })
  })
} else {
  app.get("/", (c) => c.json({ name: "fourth-spark server", status: "ok" }))
}

// ---------------------------------------------------------------------------
// Startup — run migrations, then spawn opencode for all repos
// ---------------------------------------------------------------------------
logger.info({ port: PORT }, "fourth-spark server starting")

runMigrations()
  .then((ran) => {
    if (ran) logger.info("database migrations applied")
  })
  .catch((err) => {
    logger.error({ err }, "migration failed — continuing with existing schema")
  })

processManager.startAll().then(() => {
  logger.info("all repos initialized")
}).catch((err) => {
  logger.error({ err }, "failed to initialize repos")
})

// ---------------------------------------------------------------------------
// Graceful shutdown — covers SIGINT (Ctrl-C), SIGTERM (kill), SIGHUP (bun --watch)
// ---------------------------------------------------------------------------
async function gracefulShutdown(signal: string) {
  logger.info({ signal }, "shutting down — stopping all opencode processes")
  await processManager.stopAll()
  process.exit(0)
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"))
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGHUP", () => {
  logger.info("SIGHUP received (bun --watch) — keeping opencode processes alive")
  process.exit(0)
})

// Bun serves the default export. `idleTimeout: 0` disables the socket idle
// timeout so long-lived SSE connections are not dropped.
export default {
  port: PORT,
  idleTimeout: 0,
  fetch: app.fetch,
}

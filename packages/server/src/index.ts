import { Hono } from "hono"
import { corsMiddleware } from "./middleware/cors"
import { requestLogger, logger } from "./middleware/logger"
import { onError } from "./middleware/errors"
import { sessions } from "./routes/sessions"
import { events } from "./routes/events"
import { agents } from "./routes/agents"
import { health } from "./routes/health"
import { OPENCODE_URL, WORKSPACE_DIR, PORT } from "./lib/config"
import "./db/index"

const app = new Hono()

app.use("*", corsMiddleware)
app.use("*", requestLogger)
app.onError(onError)

// Session CRUD/prompt/status routes and the session-scoped SSE proxy share the
// same base path (events.ts owns `/:id/events`).
app.route("/api/sessions", sessions)
app.route("/api/sessions", events)
app.route("/api/agents", agents)
app.route("/api/health", health)

app.get("/", (c) => c.json({ name: "fourth-spark server", status: "ok" }))

logger.info(
  { port: PORT, opencodeUrl: OPENCODE_URL, workspace: WORKSPACE_DIR },
  "fourth-spark server starting",
)

// Bun serves the default export. `idleTimeout: 0` disables the socket idle
// timeout so long-lived SSE connections are not dropped.
export default {
  port: PORT,
  idleTimeout: 0,
  fetch: app.fetch,
}

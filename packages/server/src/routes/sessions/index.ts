import { Hono } from "hono"
import { registerCrudRoutes } from "./crud"
import { registerMessageRoutes } from "./messages"
import { registerFileRoutes } from "./files"

export { buildIssueContext } from "./issue-context"

export const sessions = new Hono()

registerCrudRoutes(sessions)
registerMessageRoutes(sessions)
registerFileRoutes(sessions)

import { Hono } from "hono"
import { registerCrudRoutes } from "./crud"
import { registerFileRoutes } from "./files"
import { registerMessageRoutes } from "./messages"

export { buildIssueContext } from "./issue-context"

export const sessions = new Hono()

registerCrudRoutes(sessions)
registerMessageRoutes(sessions)
registerFileRoutes(sessions)

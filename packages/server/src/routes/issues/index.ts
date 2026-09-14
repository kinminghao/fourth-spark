import { Hono } from "hono"
import { registerCommentRoutes } from "./comments"
import { registerCrudRoutes } from "./crud"
import { registerPolishRoutes } from "./polish"
import { registerTagRoutes } from "./tags"

export const issueRoutes = new Hono()

registerCrudRoutes(issueRoutes)
registerCommentRoutes(issueRoutes)
registerPolishRoutes(issueRoutes)
registerTagRoutes(issueRoutes)

import { Hono } from "hono"
import { registerCrudRoutes } from "./crud"
import { registerCommentRoutes } from "./comments"
import { registerPolishRoutes } from "./polish"
import { registerTagRoutes } from "./tags"

export const issueRoutes = new Hono()

registerCrudRoutes(issueRoutes)
registerCommentRoutes(issueRoutes)
registerPolishRoutes(issueRoutes)
registerTagRoutes(issueRoutes)

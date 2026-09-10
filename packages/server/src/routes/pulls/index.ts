import { Hono } from "hono"
import { registerCrudRoutes } from "./crud"
import { registerDetailRoutes } from "./details"

export const pullRoutes = new Hono()

registerCrudRoutes(pullRoutes)
registerDetailRoutes(pullRoutes)

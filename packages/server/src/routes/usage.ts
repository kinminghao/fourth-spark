import { Hono } from "hono"
import { collectUsage } from "../lib/claude-usage"

export const usageRoutes = new Hono()

// GET /api/usage — returns Claude subscription usage for all stored accounts.
usageRoutes.get("/", async (c) => {
  const result = await collectUsage()
  return c.json(result)
})

import { Hono } from "hono"
import { collectUsage, switchAccount } from "../lib/claude-usage"

export const usageRoutes = new Hono()

// GET /api/usage — returns Claude subscription usage for all stored accounts.
usageRoutes.get("/", async (c) => {
  const result = await collectUsage()
  return c.json(result)
})

// POST /api/usage/switch — switch active Claude account, then return fresh usage.
usageRoutes.post("/switch", async (c) => {
  const body = await c.req.json<{ accountId?: string }>()
  if (!body.accountId || typeof body.accountId !== "string") {
    return c.json({ error: "accountId is required" }, 400)
  }
  try {
    await switchAccount(body.accountId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: msg }, 400)
  }
  const result = await collectUsage()
  return c.json(result)
})

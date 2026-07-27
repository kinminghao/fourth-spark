import { Hono } from "hono"
import { collectUsage, retagActiveInCache } from "../lib/claude-usage"
import { switchToAccount } from "../lib/account-switcher"

export const usageRoutes = new Hono()

// GET /api/usage — returns Claude subscription usage for all stored accounts.
usageRoutes.get("/", async (c) => {
  const result = await collectUsage()
  return c.json(result)
})

// POST /api/usage/switch — switch active Claude account, then return fresh usage.
// Uses account-switcher.switchToAccount() which properly writes both
// claude-accounts.json AND auth.json (the file opencode actually reads).
usageRoutes.post("/switch", async (c) => {
  const body = await c.req.json<{ accountId?: string }>()
  if (!body.accountId || typeof body.accountId !== "string") {
    return c.json({ error: "accountId is required" }, 400)
  }
  try {
    await switchToAccount(body.accountId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: msg }, 400)
  }
  const result = retagActiveInCache(body.accountId) ?? await collectUsage()
  return c.json(result)
})

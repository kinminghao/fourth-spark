import { Hono } from "hono"
import { z } from "zod"
import {
  createDevice,
  deleteDevice,
  hasAnyDevices,
  isPairWindowOpen,
  closePairWindow,
  listDevices,
  openPairWindow,
  getPairWindowStatus,
  verifyToken,
} from "../lib/auth"
import { parseBody } from "../lib/validation"

export const authRoutes = new Hono()

const RegisterDeviceBody = z.object({
  name: z.string().min(1).max(100),
})

const TokenBody = z.object({
  token: z.string().min(1).max(200),
  name: z.string().min(1).max(100),
})

// GET /api/auth/status — public, tells client whether auth is required
authRoutes.get("/status", (c) => {
  return c.json({ authRequired: hasAnyDevices() })
})

// GET /api/auth/devices — list all registered devices (authenticated only)
authRoutes.get("/devices", async (c) => {
  const rows = await listDevices()
  return c.json(rows)
})

// DELETE /api/auth/devices/:id — revoke a device (authenticated only)
authRoutes.delete("/devices/:id", async (c) => {
  const id = c.req.param("id")
  const deleted = await deleteDevice(id)
  if (!deleted) return c.json({ error: "Device not found" }, 404)
  return c.json({ ok: true })
})

// POST /api/auth/pair/start — open pairing window (authenticated only)
authRoutes.post("/pair/start", (c) => {
  const result = openPairWindow()
  return c.json(result)
})

// GET /api/auth/pair/status — check if pairing window is open (public)
authRoutes.get("/pair/status", (c) => {
  return c.json(getPairWindowStatus())
})

// POST /api/auth/pair/complete — register new device during pairing window (public)
authRoutes.post("/pair/complete", async (c) => {
  if (!isPairWindowOpen()) {
    return c.json({ error: "Pairing window is not open" }, 403)
  }

  const [body, err] = await parseBody(c, RegisterDeviceBody)
  if (err) return err

  const { device, token } = await createDevice(body.name)
  closePairWindow()

  return c.json({ device, token }, 201)
})

// POST /api/auth/token — authenticate with a known token (public, for manual input)
authRoutes.post("/token", async (c) => {
  const [body, err] = await parseBody(c, TokenBody)
  if (err) return err

  const deviceId = verifyToken(body.token)
  if (deviceId) {
    return c.json({ ok: true, deviceId })
  }

  // Token not recognized — register as new device if no devices exist yet (first-run)
  if (!hasAnyDevices()) {
    const { device, token } = await createDevice(body.name, body.token)
    return c.json({ device, token }, 201)
  }

  return c.json({ error: "Invalid token" }, 401)
})

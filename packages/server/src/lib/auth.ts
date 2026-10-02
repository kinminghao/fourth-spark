// ---------------------------------------------------------------------------
// Auth service — device token management with in-memory cache
//
// Tokens are 8-char alphanumeric strings (48-bit entropy), sufficient for
// LAN-only threat model. Stored as SHA-256 hashes in PostgreSQL.
// The in-memory cache avoids DB queries on every request.
// ---------------------------------------------------------------------------

import { randomBytes, createHash, timingSafeEqual } from "node:crypto"
import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { devices } from "../db/schema"
import { logger } from "../middleware/logger"

const TOKEN_LENGTH = 8
const TOKEN_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// Pairing window: when active, unauthenticated clients can call the pair endpoint
const PAIR_WINDOW_DURATION_MS = 60_000
let pairWindowExpiresAt = 0

// In-memory cache: tokenHash → deviceId
// Loaded once at startup, updated on device add/remove.
const tokenHashCache = new Map<string, string>()

// ---------------------------------------------------------------------------
// Token utilities
// ---------------------------------------------------------------------------

export function generateToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH)
  let token = ""
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += TOKEN_CHARSET[bytes[i] % TOKEN_CHARSET.length]
  }
  return token
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/**
 * Timing-safe token verification against the cache.
 * Returns the device ID if valid, null otherwise.
 */
export function verifyToken(token: string): string | null {
  const incoming = hashToken(token)
  const incomingBuf = Buffer.from(incoming, "utf-8")

  for (const [cachedHash, deviceId] of tokenHashCache) {
    const cachedBuf = Buffer.from(cachedHash, "utf-8")
    if (incomingBuf.length === cachedBuf.length && timingSafeEqual(incomingBuf, cachedBuf)) {
      return deviceId
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

export async function loadTokenCache(): Promise<void> {
  const rows = await db.select({ id: devices.id, tokenHash: devices.tokenHash }).from(devices)
  tokenHashCache.clear()
  for (const row of rows) {
    tokenHashCache.set(row.tokenHash, row.id)
  }
  logger.info({ deviceCount: rows.length }, "auth token cache loaded")
}

export function hasAnyDevices(): boolean {
  return tokenHashCache.size > 0
}

// ---------------------------------------------------------------------------
// Device CRUD
// ---------------------------------------------------------------------------

export interface DeviceInfo {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
}

export async function createDevice(name: string, envToken?: string): Promise<{ device: DeviceInfo; token: string }> {
  const token = envToken ?? generateToken()
  const tokenH = hashToken(token)
  const now = Date.now()
  const id = crypto.randomUUID()

  await db.insert(devices).values({
    id,
    name,
    tokenHash: tokenH,
    createdAt: now,
    lastSeenAt: now,
  })

  tokenHashCache.set(tokenH, id)

  const device: DeviceInfo = { id, name, createdAt: now, lastSeenAt: now }
  logger.info({ deviceId: id, name }, "device registered")
  return { device, token }
}

export async function listDevices(): Promise<DeviceInfo[]> {
  const rows = await db
    .select({
      id: devices.id,
      name: devices.name,
      createdAt: devices.createdAt,
      lastSeenAt: devices.lastSeenAt,
    })
    .from(devices)
  return rows
}

export async function deleteDevice(deviceId: string): Promise<boolean> {
  const [row] = await db.select({ tokenHash: devices.tokenHash }).from(devices).where(eq(devices.id, deviceId))
  if (!row) return false

  await db.delete(devices).where(eq(devices.id, deviceId))
  tokenHashCache.delete(row.tokenHash)
  logger.info({ deviceId }, "device removed")
  return true
}

export async function touchDevice(deviceId: string): Promise<void> {
  await db.update(devices).set({ lastSeenAt: Date.now() }).where(eq(devices.id, deviceId))
}

// ---------------------------------------------------------------------------
// Pairing window
// ---------------------------------------------------------------------------

export function openPairWindow(): { expiresAt: number } {
  pairWindowExpiresAt = Date.now() + PAIR_WINDOW_DURATION_MS
  logger.info({ expiresAt: pairWindowExpiresAt, durationMs: PAIR_WINDOW_DURATION_MS }, "pairing window opened")
  return { expiresAt: pairWindowExpiresAt }
}

export function isPairWindowOpen(): boolean {
  return Date.now() < pairWindowExpiresAt
}

export function closePairWindow(): void {
  pairWindowExpiresAt = 0
}

export function getPairWindowStatus(): { open: boolean; expiresAt: number } {
  return { open: isPairWindowOpen(), expiresAt: pairWindowExpiresAt }
}

import { readFileSync } from "node:fs"
import { createSign } from "node:crypto"
import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { deviceTokens } from "../db/schema"
import { APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_PATH, APNS_BUNDLE_ID, APNS_PRODUCTION } from "./config"
import { logger } from "../middleware/logger"

const SANDBOX_HOST = "https://api.sandbox.push.apple.com"
const PRODUCTION_HOST = "https://api.push.apple.com"
const TOKEN_TTL_MS = 50 * 60_000

let cachedKey: string | undefined
let cachedJwt: { token: string; expiresAt: number } | undefined

function isConfigured(): boolean {
  return Boolean(APNS_KEY_ID && APNS_TEAM_ID && APNS_KEY_PATH)
}

function loadKey(): string {
  if (!cachedKey) {
    cachedKey = readFileSync(APNS_KEY_PATH, "utf8")
  }
  return cachedKey
}

function makeJwt(): string {
  if (cachedJwt && Date.now() < cachedJwt.expiresAt) return cachedJwt.token

  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: APNS_KEY_ID })).toString("base64url")
  const iat = Math.floor(Date.now() / 1000)
  const claims = Buffer.from(JSON.stringify({ iss: APNS_TEAM_ID, iat })).toString("base64url")
  const unsigned = `${header}.${claims}`

  const sign = createSign("SHA256")
  sign.update(unsigned)
  const sig = sign.sign(loadKey(), "base64url")

  const token = `${unsigned}.${sig}`
  cachedJwt = { token, expiresAt: Date.now() + TOKEN_TTL_MS }
  return token
}

interface PushPayload {
  sessionId: string
  title: string
  body: string
}

async function sendToDevice(deviceToken: string, payload: PushPayload): Promise<boolean> {
  const host = APNS_PRODUCTION ? PRODUCTION_HOST : SANDBOX_HOST
  const url = `${host}/3/device/${deviceToken}`

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `bearer ${makeJwt()}`,
        "apns-topic": APNS_BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
      },
      body: JSON.stringify({
        aps: {
          alert: { title: payload.title, body: payload.body },
          sound: "default",
          "thread-id": payload.sessionId,
        },
        sessionId: payload.sessionId,
      }),
    })

    if (res.status === 410) {
      logger.info({ deviceToken }, "APNs: device unregistered, removing token")
      await db.delete(deviceTokens).where(eq(deviceTokens.token, deviceToken))
      return false
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      logger.warn({ deviceToken, status: res.status, body }, "APNs: push failed")
      return false
    }

    return true
  } catch (err) {
    logger.warn({ err, deviceToken }, "APNs: network error")
    return false
  }
}

export async function pushNotify(title: string, body: string, data?: Record<string, string>): Promise<void> {
  if (!isConfigured()) return

  const tokens = await db.select({ token: deviceTokens.token }).from(deviceTokens)
  if (tokens.length === 0) return

  logger.info({ count: tokens.length, title }, "APNs: sending push")

  await Promise.allSettled(tokens.map((t) => sendToDevice(t.token, { sessionId: data?.sessionId ?? "", title, body })))
}

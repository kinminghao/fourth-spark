import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import type { CredentialWriter } from "../../core/runtime-types"

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json")

interface ClaudeOAuth {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  scopes?: string[]
  subscriptionType?: string
  rateLimitTier?: string
  [key: string]: unknown
}

interface ClaudeCredentialsFile {
  claudeAiOauth?: ClaudeOAuth
  [key: string]: unknown
}

async function readCredentials(): Promise<ClaudeCredentialsFile> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, "utf-8")
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ClaudeCredentialsFile
    }
    return {}
  } catch {
    return {}
  }
}

async function writeCredentials(creds: ClaudeCredentialsFile): Promise<void> {
  await mkdir(dirname(CREDENTIALS_PATH), { recursive: true })
  const tmp = `${CREDENTIALS_PATH}.tmp-${process.pid}`
  await writeFile(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 })
  await rename(tmp, CREDENTIALS_PATH)
}

export const claudeCodeCredentialWriter: CredentialWriter = {
  async read() {
    const creds = await readCredentials()
    const oauth = creds.claudeAiOauth
    if (!oauth?.accessToken) return undefined
    return {
      access: oauth.accessToken,
      refresh: oauth.refreshToken,
      expires: oauth.expiresAt,
    }
  },

  async write(token) {
    const creds = await readCredentials()
    const oauth: ClaudeOAuth = creds.claudeAiOauth ?? {}
    if (token.kind === "full") {
      oauth.accessToken = token.access
      oauth.refreshToken = token.refresh
      if (token.expires !== undefined) oauth.expiresAt = token.expires
    } else {
      oauth.accessToken = token.access
      oauth.expiresAt = token.expires
    }
    creds.claudeAiOauth = oauth
    await writeCredentials(creds)
  },
}

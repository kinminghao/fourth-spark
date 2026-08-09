// ---------------------------------------------------------------------------
// Claude Code CredentialWriter — reads and writes ~/.claude/.credentials.json,
// the OAuth token store used by the Claude Code CLI. Writes are atomic (temp
// file + rename) with 0600 permissions so a partial write never leaves an
// unreadable-or-broken credentials file for the CLI.
// ---------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import type { CredentialWriter } from "../../core/runtime-types"

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json")

interface ClaudeCredentials {
  oauth_access_token?: string
  oauth_refresh_token?: string
  oauth_expires_at?: number
  [key: string]: unknown
}

async function readCredentials(): Promise<ClaudeCredentials> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, "utf-8")
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ClaudeCredentials
    }
    return {}
  } catch {
    return {}
  }
}

async function writeCredentials(creds: ClaudeCredentials): Promise<void> {
  await mkdir(dirname(CREDENTIALS_PATH), { recursive: true })
  const tmp = `${CREDENTIALS_PATH}.tmp-${process.pid}`
  await writeFile(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 })
  await rename(tmp, CREDENTIALS_PATH)
}

export const claudeCodeCredentialWriter: CredentialWriter = {
  async read() {
    const creds = await readCredentials()
    if (!creds.oauth_access_token && !creds.oauth_refresh_token) return undefined
    return {
      access: creds.oauth_access_token,
      refresh: creds.oauth_refresh_token,
      expires: creds.oauth_expires_at,
    }
  },

  async write(token) {
    const creds = await readCredentials()
    if (token.kind === "full") {
      creds.oauth_refresh_token = token.refresh
      if (token.access !== undefined) creds.oauth_access_token = token.access
      if (token.expires !== undefined) creds.oauth_expires_at = token.expires
    } else {
      creds.oauth_access_token = token.access
      creds.oauth_expires_at = token.expires
    }
    await writeCredentials(creds)
  },
}

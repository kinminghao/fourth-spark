// ---------------------------------------------------------------------------
// v1 credential adapter — reads/writes a provider entry in the shared OpenCode
// auth.json. A future v2 adapter for the SQLite credential store
// (~/.local/share/opencode/opencode.db) implements the same CredentialAdapter
// interface and replaces a descriptor's adapter without core-flow changes.
// ---------------------------------------------------------------------------

import { readApiKeyEntry, readAuthEntry, removeAuthEntry, writeApiKeyEntry, writeAuthEntry } from "../auth-files"
import type { ApiKeyCredentialAdapter, CredentialAdapter } from "./types"

export function createAuthJsonCredentialAdapter(entryKey: string): CredentialAdapter {
  return {
    kind: "oauth",
    read: () => readAuthEntry(entryKey),
    write: (token) => writeAuthEntry(entryKey, token),
  }
}

export function createAuthJsonApiKeyAdapter(entryKey: string): ApiKeyCredentialAdapter {
  return {
    kind: "api-key",
    read: async () => {
      const key = await readApiKeyEntry(entryKey)
      return key === undefined ? undefined : { refresh: key, access: key }
    },
    write: async (token) => {
      if (token.kind !== "full") throw new Error("lease writes are not supported for api-key providers")
      await writeApiKeyEntry(entryKey, token.refresh)
    },
    clear: () => removeAuthEntry(entryKey),
  }
}

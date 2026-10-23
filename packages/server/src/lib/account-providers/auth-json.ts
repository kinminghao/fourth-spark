// ---------------------------------------------------------------------------
// v1 credential adapter — reads/writes a provider entry in the shared OpenCode
// auth.json. A future v2 adapter for the SQLite credential store
// (~/.local/share/opencode/opencode.db) implements the same CredentialAdapter
// interface and replaces a descriptor's adapter without core-flow changes.
// ---------------------------------------------------------------------------

import { readAuthEntry, writeAuthEntry } from "../auth-files"
import type { CredentialAdapter } from "./types"

export function createAuthJsonCredentialAdapter(entryKey: string): CredentialAdapter {
  return {
    read: () => readAuthEntry(entryKey),
    write: (token) => writeAuthEntry(entryKey, token),
  }
}

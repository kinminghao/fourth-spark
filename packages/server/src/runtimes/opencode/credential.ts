// ---------------------------------------------------------------------------
// OpenCode CredentialWriter — reads and writes ~/.local/share/opencode/auth.json
// (or the XDG-resolved equivalent) via the existing auth-files helpers.
// ---------------------------------------------------------------------------

import type { CredentialWriter } from "../../core/runtime-types"
import { readAuthAnthropic, writeAuthAnthropic } from "../../lib/auth-files"

export const openCodeCredentialWriter: CredentialWriter = {
  async read() {
    return readAuthAnthropic()
  },
  async write(token) {
    if (token.kind === "full") {
      await writeAuthAnthropic({
        kind: "full",
        refresh: token.refresh,
        access: token.access,
        expires: token.expires,
      })
    } else {
      await writeAuthAnthropic({
        kind: "lease",
        access: token.access,
        expires: token.expires,
      })
    }
  },
}

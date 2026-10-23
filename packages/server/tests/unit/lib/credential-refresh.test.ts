import { describe, expect, test } from "bun:test"
import type { RuntimeProvider } from "../../../src/core/runtime-provider"
import type { RuntimeCredentialChannel } from "../../../src/core/runtime-types"
import { refreshAccountStoreRuntimes } from "../../../src/lib/credential-refresh"

function stubProvider(id: string, channel: RuntimeCredentialChannel, refresh?: () => Promise<void>): RuntimeProvider {
  return {
    id,
    credentialChannel: channel,
    ...(refresh ? { refreshCredentials: refresh } : {}),
    credentialWriter: {
      read: async () => undefined,
      write: async () => {},
    },
    initialize: async () => {},
    teardown: async () => {},
    isReady: () => false,
    getClient: () => null,
    healthCheck: async () => ({ reachable: false }),
    injectMcp: () => {},
    removeMcp: () => {},
    killAllSync: () => {},
  }
}

describe("refreshAccountStoreRuntimes", () => {
  test("refreshes account-store runtimes and skips runtime-push runtimes", async () => {
    const refreshed: string[] = []
    const providers = [
      stubProvider("opencode", "account-store", async () => {
        refreshed.push("opencode")
      }),
      stubProvider("claude-code", "runtime-push", async () => {
        refreshed.push("claude-code")
      }),
    ]

    await refreshAccountStoreRuntimes(providers)

    expect(refreshed).toEqual(["opencode"])
  })

  test("skips account-store runtimes without a refresh implementation", async () => {
    await refreshAccountStoreRuntimes([stubProvider("legacy", "account-store")])
  })

  test("swallows refresh failures so the account operation still succeeds", async () => {
    const refreshed: string[] = []
    const providers = [
      stubProvider("broken", "account-store", async () => {
        throw new Error("boom")
      }),
      stubProvider("opencode", "account-store", async () => {
        refreshed.push("opencode")
      }),
    ]

    await refreshAccountStoreRuntimes(providers)

    expect(refreshed).toEqual(["opencode"])
  })

  test("empty provider set is a no-op", async () => {
    await refreshAccountStoreRuntimes([])
  })
})

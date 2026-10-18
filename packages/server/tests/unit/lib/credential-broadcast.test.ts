import { describe, expect, test } from "bun:test"
import type { RuntimeProvider } from "../../../src/core/runtime-provider"
import type { RuntimeCredentialChannel } from "../../../src/core/runtime-types"
import type { TokenWrite } from "../../../src/lib/auth-files"
import { pushCredentialToProviders } from "../../../src/lib/credential-broadcast"

function stubProvider(
  id: string,
  channel: RuntimeCredentialChannel,
  onWrite: (token: TokenWrite) => Promise<void>,
): RuntimeProvider {
  return {
    id,
    credentialChannel: channel,
    credentialWriter: {
      read: async () => undefined,
      write: onWrite,
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

describe("pushCredentialToProviders", () => {
  test("skips account-store runtimes and pushes to runtime-push runtimes", async () => {
    const written: Array<{ id: string; token: TokenWrite }> = []
    const providers = [
      stubProvider("opencode", "account-store", async (token) => {
        written.push({ id: "opencode", token })
      }),
      stubProvider("claude-code", "runtime-push", async (token) => {
        written.push({ id: "claude-code", token })
      }),
    ]

    await pushCredentialToProviders(providers, { kind: "full", refresh: "r", access: "a", expires: 1 })

    expect(written).toEqual([{ id: "claude-code", token: { kind: "full", refresh: "r", access: "a", expires: 1 } }])
  })

  test("pushes lease tokens to runtime-push runtimes", async () => {
    const written: TokenWrite[] = []
    const providers = [
      stubProvider("claude-code", "runtime-push", async (token) => {
        written.push(token)
      }),
    ]

    await pushCredentialToProviders(providers, { kind: "lease", access: "a", expires: 2 })

    expect(written).toEqual([{ kind: "lease", access: "a", expires: 2 }])
  })

  test("swallows writer failures and continues", async () => {
    const written: string[] = []
    const providers = [
      stubProvider("broken", "runtime-push", async () => {
        throw new Error("boom")
      }),
      stubProvider("claude-code", "runtime-push", async () => {
        written.push("claude-code")
      }),
    ]

    await pushCredentialToProviders(providers, { kind: "lease", access: "a", expires: 2 })

    expect(written).toEqual(["claude-code"])
  })

  test("empty provider set is a no-op", async () => {
    await pushCredentialToProviders([], { kind: "lease", access: "a", expires: 2 })
  })
})

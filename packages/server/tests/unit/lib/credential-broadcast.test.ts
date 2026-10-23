import { describe, expect, test } from "bun:test"
import type { RuntimeProvider } from "../../../src/core/runtime-provider"
import type { RuntimeCredentialChannel } from "../../../src/core/runtime-types"
import type { ProviderId, TokenWrite } from "../../../src/lib/auth-files"
import { pushCredentialToProviders } from "../../../src/lib/credential-broadcast"

function stubProvider(
  id: string,
  channel: RuntimeCredentialChannel,
  onWrite: (token: TokenWrite) => Promise<void>,
  accountProvider?: ProviderId,
): RuntimeProvider {
  return {
    id,
    credentialChannel: channel,
    ...(accountProvider ? { accountProvider } : {}),
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
      stubProvider(
        "claude-code",
        "runtime-push",
        async (token) => {
          written.push({ id: "claude-code", token })
        },
        "anthropic",
      ),
    ]

    await pushCredentialToProviders(providers, "anthropic", { kind: "full", refresh: "r", access: "a", expires: 1 })

    expect(written).toEqual([{ id: "claude-code", token: { kind: "full", refresh: "r", access: "a", expires: 1 } }])
  })

  test("pushes lease tokens to runtime-push runtimes", async () => {
    const written: TokenWrite[] = []
    const providers = [
      stubProvider(
        "claude-code",
        "runtime-push",
        async (token) => {
          written.push(token)
        },
        "anthropic",
      ),
    ]

    await pushCredentialToProviders(providers, "anthropic", { kind: "lease", access: "a", expires: 2 })

    expect(written).toEqual([{ kind: "lease", access: "a", expires: 2 }])
  })

  test("swallows writer failures and continues", async () => {
    const written: string[] = []
    const providers = [
      stubProvider(
        "broken",
        "runtime-push",
        async () => {
          throw new Error("boom")
        },
        "anthropic",
      ),
      stubProvider(
        "claude-code",
        "runtime-push",
        async () => {
          written.push("claude-code")
        },
        "anthropic",
      ),
    ]

    await pushCredentialToProviders(providers, "anthropic", { kind: "lease", access: "a", expires: 2 })

    expect(written).toEqual(["claude-code"])
  })

  test("routes only to runtimes bound to the given account provider", async () => {
    const written: string[] = []
    const providers = [
      stubProvider(
        "claude-code",
        "runtime-push",
        async () => {
          written.push("claude-code")
        },
        "anthropic",
      ),
      stubProvider(
        "go-code",
        "runtime-push",
        async () => {
          written.push("go-code")
        },
        "opencode-go",
      ),
    ]

    await pushCredentialToProviders(providers, "opencode-go", { kind: "full", refresh: "r", access: "a" })

    expect(written).toEqual(["go-code"])
  })

  test("account-store runtimes receive nothing even when bound to the provider", async () => {
    const written: string[] = []
    const providers = [
      stubProvider(
        "opencode",
        "account-store",
        async () => {
          written.push("opencode")
        },
        "anthropic",
      ),
    ]

    await pushCredentialToProviders(providers, "anthropic", { kind: "full", refresh: "r", access: "a" })

    expect(written).toEqual([])
  })

  test("empty provider set is a no-op", async () => {
    await pushCredentialToProviders([], "anthropic", { kind: "lease", access: "a", expires: 2 })
  })
})

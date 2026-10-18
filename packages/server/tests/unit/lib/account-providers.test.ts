import { describe, expect, test } from "bun:test"
import { DEFAULT_ACCOUNT_PROVIDER, getAccountProvider, listAccountProviders } from "../../../src/lib/account-providers"

describe("account provider registry", () => {
  test("resolves the anthropic descriptor with every declared aspect", () => {
    const provider = getAccountProvider("anthropic")
    expect(provider.id).toBe("anthropic")
    expect(provider.label).toBe("Claude")
    expect(provider.credentialAdapter.kind).toBe("oauth")
    expect(typeof provider.credentialAdapter.read).toBe("function")
    expect(typeof provider.credentialAdapter.write).toBe("function")
    expect(provider.login.kind).toBe("oauth")
    if (provider.login.kind === "oauth") {
      expect(typeof provider.login.authorize).toBe("function")
      expect(typeof provider.login.exchange).toBe("function")
    }
    expect(typeof provider.refresh.isStale).toBe("function")
    expect(typeof provider.refresh.refresh).toBe("function")
    expect(typeof provider.usage.fetch).toBe("function")
    expect(typeof provider.identity?.fetchProfile).toBe("function")
  })

  test("resolves the opencode-go descriptor with every declared aspect", async () => {
    const provider = getAccountProvider("opencode-go")
    expect(provider.id).toBe("opencode-go")
    expect(provider.label).toBe("OpenCode Go")
    expect(provider.credentialAdapter.kind).toBe("api-key")
    if (provider.credentialAdapter.kind === "api-key") {
      expect(typeof provider.credentialAdapter.clear).toBe("function")
    }
    expect(provider.login.kind).toBe("api-key")
    expect(typeof provider.refresh.isStale).toBe("function")
    expect(provider.refresh.isStale()).toBe(false)
    await expect(provider.refresh.refresh("x")).rejects.toThrow()
    expect(provider.identity).toBeUndefined()
  })

  test("lists registered providers", () => {
    expect(listAccountProviders().map((p) => p.id)).toEqual(["anthropic", "opencode-go"])
  })

  test("unknown provider ids fail loudly", () => {
    expect(() => getAccountProvider("nope")).toThrow("account provider not registered: nope")
  })

  test("default account provider is anthropic", () => {
    expect(DEFAULT_ACCOUNT_PROVIDER).toBe("anthropic")
  })

  test("opencode-go has an api-key login strategy", () => {
    const login = getAccountProvider("opencode-go").login
    expect(login.kind).toBe("api-key")
    if (login.kind === "api-key") {
      expect(typeof login.verify).toBe("function")
    }
  })
})

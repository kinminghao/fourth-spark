import { describe, expect, test } from "bun:test"
import { DEFAULT_ACCOUNT_PROVIDER, getAccountProvider, listAccountProviders } from "../../../src/lib/account-providers"

describe("account provider registry", () => {
  test("resolves the anthropic descriptor with every declared aspect", () => {
    const provider = getAccountProvider("anthropic")
    expect(provider.id).toBe("anthropic")
    expect(provider.label).toBe("Claude")
    expect(typeof provider.credentialAdapter.read).toBe("function")
    expect(typeof provider.credentialAdapter.write).toBe("function")
    expect(typeof provider.login.authorize).toBe("function")
    expect(typeof provider.login.exchange).toBe("function")
    expect(typeof provider.refresh.isStale).toBe("function")
    expect(typeof provider.refresh.refresh).toBe("function")
    expect(typeof provider.usage.fetch).toBe("function")
    expect(typeof provider.identity.fetchProfile).toBe("function")
  })

  test("lists registered providers", () => {
    expect(listAccountProviders().map((p) => p.id)).toEqual(["anthropic"])
  })

  test("unknown provider ids fail loudly", () => {
    expect(() => getAccountProvider("nope")).toThrow("account provider not registered: nope")
  })

  test("default account provider is anthropic", () => {
    expect(DEFAULT_ACCOUNT_PROVIDER).toBe("anthropic")
  })
})

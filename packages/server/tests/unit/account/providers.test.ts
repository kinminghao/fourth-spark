import { afterEach, describe, expect, test } from "bun:test"
import { poolProviderIds } from "../../../src/account/providers"

afterEach(() => {
  delete process.env.ACCOUNT_POOL_PROVIDERS
})

describe("poolProviderIds", () => {
  test("defaults to all registered providers", () => {
    expect([...poolProviderIds()].sort()).toEqual(["anthropic", "openai", "opencode-go"])
  })

  test("honors the allowlist and filters unknown ids", () => {
    process.env.ACCOUNT_POOL_PROVIDERS = "anthropic, opencode-go, nope"
    expect([...poolProviderIds()].sort()).toEqual(["anthropic", "opencode-go"])
  })

  test("an invalid allowlist disables every provider", () => {
    process.env.ACCOUNT_POOL_PROVIDERS = "nope"
    expect(poolProviderIds().size).toBe(0)
  })
})

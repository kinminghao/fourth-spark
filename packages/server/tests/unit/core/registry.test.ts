import { beforeEach, describe, expect, test } from "bun:test"
import { createDefaultRegistry, getRegistry, initRegistry } from "../../../src/core/registry"

describe("createDefaultRegistry", () => {
  test("returns registry with default gitPlatforms", () => {
    const reg = createDefaultRegistry()
    expect(reg.gitPlatforms.has("github")).toBe(true)
    expect(reg.gitPlatforms.has("gitea")).toBe(true)
    expect(reg.gitPlatforms.has("gitlab")).toBe(true)
  })

  test("returns registry with accountPool", () => {
    const reg = createDefaultRegistry()
    expect(reg.accountPool).toBeDefined()
  })

  test("returns registry with mcpTools", () => {
    const reg = createDefaultRegistry()
    expect(reg.mcpTools.length).toBeGreaterThan(0)
  })

  test("returns registry with empty providers map", () => {
    const reg = createDefaultRegistry()
    expect(reg.providers.size).toBe(0)
  })

  test("returns registry with credentialWriter", () => {
    const reg = createDefaultRegistry()
    expect(reg.credentialWriter).toBeDefined()
    expect(typeof reg.credentialWriter.read).toBe("function")
    expect(typeof reg.credentialWriter.write).toBe("function")
  })
})

describe("initRegistry / getRegistry", () => {
  beforeEach(() => {
    // Re-initialize to known state before each test
    initRegistry()
  })

  test("initRegistry returns a registry", () => {
    const reg = initRegistry()
    expect(reg).toBeDefined()
    expect(reg.gitPlatforms).toBeDefined()
  })

  test("getRegistry returns the initialized instance", () => {
    const init = initRegistry()
    const got = getRegistry()
    expect(got).toBe(init)
  })

  test("initRegistry with overrides merges onto defaults", () => {
    const reg = initRegistry({ mcpTools: [] })
    expect(reg.mcpTools).toEqual([])
    // Other fields keep defaults
    expect(reg.gitPlatforms.has("github")).toBe(true)
  })

  test("initRegistry with providers override", () => {
    const customProviders = new Map([["custom", {} as any]])
    const reg = initRegistry({ providers: customProviders })
    expect(reg.providers.has("custom")).toBe(true)
    expect(reg.providers.size).toBe(1)
  })

  test("successive initRegistry calls replace the instance", () => {
    const first = initRegistry({ mcpTools: [] })
    const second = initRegistry()
    expect(getRegistry()).toBe(second)
    expect(getRegistry()).not.toBe(first)
    expect(getRegistry().mcpTools.length).toBeGreaterThan(0)
  })
})

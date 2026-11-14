import { describe, expect, spyOn, test } from "bun:test"
import { ACCOUNT_POOL_DEFAULT_HOST, ACCOUNT_POOL_DEFAULT_PORT } from "../../../src/account/constants"
import { accountCommand, parseOptions } from "../../../src/cli/account"

describe("account command options", () => {
  test("uses host and port defaults", () => {
    expect(parseOptions([])).toEqual({ port: ACCOUNT_POOL_DEFAULT_PORT, host: ACCOUNT_POOL_DEFAULT_HOST })
  })

  test("parses explicit host and port", () => {
    expect(parseOptions(["--port", "9000", "--host", "0.0.0.0"])).toEqual({ port: 9000, host: "0.0.0.0" })
  })

  test("rejects invalid ports and hosts", () => {
    expect(parseOptions(["--port", "abc"])).toMatchObject({ error: expect.any(String) })
    expect(parseOptions(["--port", "0"])).toMatchObject({ error: expect.any(String) })
    expect(parseOptions(["--port", "70000"])).toMatchObject({ error: expect.any(String) })
    expect(parseOptions(["--host", ""])).toMatchObject({ error: expect.any(String) })
  })
})

describe("account command help", () => {
  test("prints usage for help and empty arguments", async () => {
    const log = spyOn(console, "log").mockImplementation(() => undefined)
    try {
      await accountCommand(["--help"])
      await accountCommand([])
      await accountCommand(["serve", "--help"])
      expect(log).toHaveBeenCalledTimes(3)
      expect(String(log.mock.calls[0]?.[0])).toContain("fourth-spark account")
    } finally {
      log.mockRestore()
    }
  })
})

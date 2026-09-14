import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { childEnv } from "../../src/lib/child-env"

describe("childEnv", () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    // Save and set test env vars
    for (const key of ["DATABASE_URL", "HTTPS_PORT", "FRONTEND_ORIGIN", "HOME", "PATH"]) {
      savedEnv[key] = process.env[key]
    }
    process.env.DATABASE_URL = "postgresql://test:test@localhost/test"
    process.env.HTTPS_PORT = "3443"
    process.env.FRONTEND_ORIGIN = "http://localhost:5173"
    // HOME and PATH should already exist
  })

  afterEach(() => {
    // Restore original env
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test("strips DATABASE_URL from child env", () => {
    const env = childEnv()
    expect(env.DATABASE_URL).toBeUndefined()
  })

  test("strips HTTPS_PORT from child env", () => {
    const env = childEnv()
    expect(env.HTTPS_PORT).toBeUndefined()
  })

  test("strips FRONTEND_ORIGIN from child env", () => {
    const env = childEnv()
    expect(env.FRONTEND_ORIGIN).toBeUndefined()
  })

  test("preserves non-blocked vars like HOME", () => {
    const env = childEnv()
    expect(env.HOME).toBe(process.env.HOME)
  })

  test("preserves PATH", () => {
    const env = childEnv()
    expect(env.PATH).toBe(process.env.PATH)
  })

  test("applies overrides", () => {
    const env = childEnv({ PORT: "8081", CUSTOM: "value" })
    expect(env.PORT).toBe("8081")
    expect(env.CUSTOM).toBe("value")
  })

  test("overrides take precedence over process.env", () => {
    process.env.MY_VAR = "original"
    const env = childEnv({ MY_VAR: "overridden" })
    expect(env.MY_VAR).toBe("overridden")
    delete process.env.MY_VAR
  })

  test("all blocklisted vars are stripped", () => {
    const blocklist = [
      "DATABASE_URL", "HTTPS_PORT", "FRONTEND_ORIGIN", "EXTRA_ORIGINS",
      "TLS_CERT", "TLS_KEY", "GITEA_TOKEN", "APP_VERSION", "STATIC_DIR",
      "DEFAULT_VARIANT", "MASTER_URL", "WORKER_ID", "LOG_LEVEL", "LOG_PRETTY",
      "CONSOLIDATION_DRY_RUN", "MEMORY_DEBUG", "SENSEVOICE_DIR", "HF_MIRROR",
      "MIGRATIONS_DIR",
    ]
    // Set all blocklisted vars
    for (const key of blocklist) {
      process.env[key] = "test-value"
    }

    const env = childEnv()

    for (const key of blocklist) {
      expect(env[key]).toBeUndefined()
    }

    // Cleanup
    for (const key of blocklist) {
      delete process.env[key]
    }
  })
})

import { describe, expect, test, mock, beforeEach } from "bun:test"

// Mock db module before importing routes
const mockRows: Array<{ key: string; value: string }> = []

const mockSelect = mock(() => ({
  from: mock(() => Promise.resolve([...mockRows])),
}))

const mockInsert = mock(() => ({
  values: mock(() => ({
    onConflictDoUpdate: mock(() => Promise.resolve()),
  })),
}))

const mockDelete = mock(() => ({
  where: mock(() => Promise.resolve()),
}))

mock.module("../../../src/db/index", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
  },
}))

const { settingsRoutes } = await import("../../../src/routes/settings")

describe("settings routes", () => {
  beforeEach(() => {
    mockRows.length = 0
  })

  test("GET / returns all settings as key-value map", async () => {
    mockRows.push({ key: "theme", value: "dark" }, { key: "lang", value: "en" })

    const res = await settingsRoutes.request("/")
    const body = await res.json() as Record<string, string>

    expect(res.status).toBe(200)
    expect(body.theme).toBe("dark")
    expect(body.lang).toBe("en")
  })

  test("GET / returns empty object when no settings", async () => {
    const res = await settingsRoutes.request("/")
    const body = await res.json() as Record<string, string>

    expect(res.status).toBe(200)
    expect(Object.keys(body)).toHaveLength(0)
  })

  test("PUT /:key upserts a setting", async () => {
    const res = await settingsRoutes.request("/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "dark" }),
    })
    const body = await res.json() as { ok: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockInsert).toHaveBeenCalled()
  })

  test("PUT /:key rejects missing value", async () => {
    const res = await settingsRoutes.request("/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
  })

  test("PUT /:key rejects invalid JSON", async () => {
    const res = await settingsRoutes.request("/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    })

    expect(res.status).toBe(400)
  })

  test("DELETE /:key removes a setting", async () => {
    const res = await settingsRoutes.request("/theme", {
      method: "DELETE",
    })
    const body = await res.json() as { ok: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockDelete).toHaveBeenCalled()
  })
})

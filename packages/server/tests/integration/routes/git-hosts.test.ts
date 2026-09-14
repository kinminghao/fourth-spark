import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { db } from "../../../src/db/index"
import { gitHosts } from "../../../src/db/schema"
import { gitHostRoutes } from "../../../src/routes/git-hosts"
import { truncateAll } from "../../helpers/db"

const app = new Hono()
app.route("/git-hosts", gitHostRoutes)

beforeAll(() => {
  execSync("bunx drizzle-kit push --force", {
    cwd: new URL("../../../", import.meta.url).pathname,
    env: { ...process.env },
    stdio: "pipe",
  })
})

beforeEach(async () => {
  await truncateAll(db as any)
})

const now = Date.now()

async function seedHost(id = "host-1", token = "ghp_abcdef1234567890abcdef1234567890abcd") {
  await db.insert(gitHosts).values({
    id,
    host: "github.com",
    platform: "github",
    name: "GitHub",
    token,
    createdAt: now,
    updatedAt: now,
  })
}

describe("GET /git-hosts", () => {
  test("returns empty array initially", async () => {
    const res = await app.request("/git-hosts")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  test("returns hosts with masked tokens", async () => {
    await seedHost()
    const res = await app.request("/git-hosts")
    const body = (await res.json()) as any[]

    expect(body).toHaveLength(1)
    expect(body[0].host).toBe("github.com")
    expect(body[0].token).not.toContain("ghp_abcdef")
    expect(body[0].token).toContain("••••")
  })

  test("token masking preserves first 4 and last 4 chars", async () => {
    await seedHost("h1", "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
    const res = await app.request("/git-hosts")
    const body = (await res.json()) as any[]

    expect(body[0].token).toMatch(/^ghp_.*xxxx$/)
    expect(body[0].token).toContain("••••")
  })

  test("short tokens are fully masked", async () => {
    await seedHost("h1", "abc123")
    const res = await app.request("/git-hosts")
    const body = (await res.json()) as any[]

    expect(body[0].token).toBe("••••••••")
  })
})

describe("POST /git-hosts", () => {
  test("creates a new host and returns masked token", async () => {
    const res = await app.request("/git-hosts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: "Gitea.Example.COM",
        name: "My Gitea",
        token: "tok_1234567890abcdef",
      }),
    })
    const body = (await res.json()) as any

    expect(res.status).toBe(201)
    expect(body.host).toBe("gitea.example.com")
    expect(body.platform).toBe("gitea")
    expect(body.name).toBe("My Gitea")
    expect(body.token).toContain("••••")
    expect(body.id).toBeDefined()
  })

  test("stores raw token in DB", async () => {
    await app.request("/git-hosts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: "github.com",
        name: "GH",
        token: "ghp_secrettoken123456789012345678901234",
      }),
    })

    const rows = await db.select().from(gitHosts)
    expect(rows).toHaveLength(1)
    expect(rows[0].token).toBe("ghp_secrettoken123456789012345678901234")
  })

  test("rejects missing required fields", async () => {
    const res = await app.request("/git-hosts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "example.com" }),
    })
    expect(res.status).toBe(400)
  })
})

describe("PUT /git-hosts/:id", () => {
  test("updates host fields", async () => {
    await seedHost("h1")
    const res = await app.request("/git-hosts/h1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Name" }),
    })
    const body = (await res.json()) as any

    expect(res.status).toBe(200)
    expect(body.name).toBe("Updated Name")
    expect(body.host).toBe("github.com")
  })

  test("updates token and returns masked version", async () => {
    await seedHost("h1")
    const res = await app.request("/git-hosts/h1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "new_secrettoken1234567890abcdef12" }),
    })
    const body = (await res.json()) as any

    expect(body.token).toContain("••••")
    expect(body.token).not.toBe("new_secrettoken1234567890abcdef12")

    const [row] = await db.select().from(gitHosts).where(eq(gitHosts.id, "h1"))
    expect(row.token).toBe("new_secrettoken1234567890abcdef12")
  })

  test("returns 404 for non-existent host", async () => {
    const res = await app.request("/git-hosts/nonexistent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    })
    expect(res.status).toBe(404)
  })
})

describe("DELETE /git-hosts/:id", () => {
  test("deletes a host", async () => {
    await seedHost("h1")
    const res = await app.request("/git-hosts/h1", { method: "DELETE" })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const rows = await db.select().from(gitHosts)
    expect(rows).toHaveLength(0)
  })

  test("succeeds even for non-existent id", async () => {
    const res = await app.request("/git-hosts/nope", { method: "DELETE" })
    expect(res.status).toBe(200)
  })
})

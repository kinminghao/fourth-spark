import { describe, test, expect, beforeAll, beforeEach } from "bun:test"
import { eq } from "drizzle-orm"
import { db } from "../../../src/db/index"
import { sessions, messages, parts, todos } from "../../../src/db/schema"
import { syncSessionsList, syncMessagesList, syncSseEvent } from "../../../src/db/sync"
import { truncateAll } from "../../helpers/db"
import { execSync } from "node:child_process"

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

describe("syncSessionsList", () => {
  test("inserts new sessions", async () => {
    await syncSessionsList([
      { id: "ses-1", title: "First", time: { created: now, updated: now } },
      { id: "ses-2", title: "Second", time: { created: now, updated: now } },
    ])

    const rows = await db.select().from(sessions)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.id).sort()).toEqual(["ses-1", "ses-2"])
  })

  test("upsert is idempotent — re-inserting same id updates non-title fields", async () => {
    await syncSessionsList([
      { id: "ses-1", title: "Original", agent: "build", time: { created: now, updated: now } },
    ])
    await syncSessionsList([
      { id: "ses-1", title: "Renamed", agent: "oracle", time: { created: now, updated: now + 1000 } },
    ])

    const [row] = await db.select().from(sessions).where(eq(sessions.id, "ses-1"))
    expect(row.agent).toBe("oracle")
    expect(row.title).toBe("Original")
  })

  test("skips items without id", async () => {
    await syncSessionsList([
      { title: "No ID" },
      { id: "ses-valid", title: "Has ID", time: { created: now, updated: now } },
    ])

    const rows = await db.select().from(sessions)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe("ses-valid")
  })
})

describe("syncMessagesList", () => {
  test("inserts messages and ensures session exists", async () => {
    await syncMessagesList("ses-new", [
      { id: "msg-1", role: "user", time: { created: now, updated: now } },
    ])

    const sessionRows = await db.select().from(sessions).where(eq(sessions.id, "ses-new"))
    expect(sessionRows).toHaveLength(1)

    const msgRows = await db.select().from(messages).where(eq(messages.sessionId, "ses-new"))
    expect(msgRows).toHaveLength(1)
    expect(msgRows[0].role).toBe("user")
  })

  test("inserts message parts", async () => {
    await syncMessagesList("ses-1", [
      {
        id: "msg-1",
        role: "assistant",
        time: { created: now, updated: now },
        parts: [
          { id: "p-1", type: "text", content: "hello", time: { created: now, updated: now } },
        ],
      },
    ])

    const partRows = await db.select().from(parts).where(eq(parts.sessionId, "ses-1"))
    expect(partRows).toHaveLength(1)
    expect(partRows[0].type).toBe("text")
    expect((partRows[0].data as any).content).toBe("hello")
  })

  test("upsert message is idempotent", async () => {
    await syncMessagesList("ses-1", [
      { id: "msg-1", role: "user", time: { created: now, updated: now } },
    ])
    await syncMessagesList("ses-1", [
      { id: "msg-1", role: "user", agent: "build", time: { created: now, updated: now + 1 } },
    ])

    const msgRows = await db.select().from(messages).where(eq(messages.id, "msg-1"))
    expect(msgRows).toHaveLength(1)
    expect(msgRows[0].agent).toBe("build")
  })
})

describe("syncSseEvent", () => {
  test("session.updated creates/updates session", async () => {
    await syncSseEvent(
      "ses-1",
      "session.updated",
      JSON.stringify({
        properties: { id: "ses-1", title: "SSE Session", time: { created: now, updated: now } },
      }),
    )

    const [row] = await db.select().from(sessions).where(eq(sessions.id, "ses-1"))
    expect(row).toBeDefined()
    expect(row.title).toBe("SSE Session")
  })

  test("message.updated upserts message", async () => {
    await syncSseEvent(
      "ses-1",
      "message.updated",
      JSON.stringify({
        properties: {
          id: "msg-1",
          role: "assistant",
          time: { created: now, updated: now },
        },
      }),
    )

    const sessionRows = await db.select().from(sessions).where(eq(sessions.id, "ses-1"))
    expect(sessionRows).toHaveLength(1)

    const msgRows = await db.select().from(messages).where(eq(messages.id, "msg-1"))
    expect(msgRows).toHaveLength(1)
  })

  test("todo.updated replaces todos for session", async () => {
    await syncSseEvent(
      "ses-1",
      "todo.updated",
      JSON.stringify({
        properties: {
          todos: [
            { content: "Task A", status: "pending" },
            { content: "Task B", status: "completed" },
          ],
        },
      }),
    )

    const todoRows = await db.select().from(todos).where(eq(todos.sessionId, "ses-1"))
    expect(todoRows).toHaveLength(2)
    expect(todoRows[0].content).toBe("Task A")
    expect(todoRows[1].content).toBe("Task B")
  })

  test("ignores unparseable JSON", async () => {
    await syncSseEvent("ses-1", "session.updated", "not json{")
  })
})

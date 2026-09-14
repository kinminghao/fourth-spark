import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { db } from "../../../src/db/index"
import {
  getMessageCount,
  getMessagesFromDB,
  getMessagesPaginated,
  getRepoDirectory,
  getSessionFromDB,
  getTodosFromDB,
  listSessionsFromDB,
} from "../../../src/db/query"
import { messages, parts, repos, sessions, todos } from "../../../src/db/schema"
import { truncateAll } from "../../helpers/db"

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

async function seedRepo(id = "repo-1") {
  await db.insert(repos).values({
    id,
    name: "test-repo",
    gitUrl: "https://github.com/test/repo.git",
    localPath: `/tmp/test/${id}`,
    createdAt: now,
    updatedAt: now,
  })
}

async function seedSession(id: string, dir: string, timeUpdated = now) {
  await db.insert(sessions).values({
    id,
    directory: dir,
    title: `Session ${id}`,
    timeCreated: now,
    timeUpdated,
  })
}

async function seedMessage(id: string, sessionId: string, role: string, timeCreated: number) {
  await db.insert(messages).values({
    id,
    sessionId,
    role,
    timeCreated,
    timeUpdated: timeCreated,
  })
}

async function seedPart(
  id: string,
  messageId: string,
  sessionId: string,
  type: string,
  data: Record<string, unknown>,
  timeCreated: number,
) {
  await db.insert(parts).values({
    id,
    messageId,
    sessionId,
    type,
    data,
    timeCreated,
    timeUpdated: timeCreated,
  })
}

describe("getRepoDirectory", () => {
  test("returns localPath for existing repo", async () => {
    await seedRepo("repo-1")
    const dir = await getRepoDirectory("repo-1")
    expect(dir).toBe("/tmp/test/repo-1")
  })

  test("returns null for non-existent repo", async () => {
    const dir = await getRepoDirectory("nonexistent")
    expect(dir).toBeNull()
  })
})

describe("listSessionsFromDB", () => {
  test("returns sessions filtered by directory", async () => {
    await seedSession("ses-1", "/tmp/a", now)
    await seedSession("ses-2", "/tmp/b", now)
    await seedSession("ses-3", "/tmp/a", now + 1000)

    const result = await listSessionsFromDB("/tmp/a")
    expect(result).toHaveLength(2)
    expect(result.map((s) => s.id)).toEqual(["ses-3", "ses-1"])
  })

  test("returns empty array when no sessions match", async () => {
    const result = await listSessionsFromDB("/no/match")
    expect(result).toEqual([])
  })

  test("sessions ordered by timeUpdated descending", async () => {
    await seedSession("old", "/dir", now)
    await seedSession("new", "/dir", now + 5000)
    await seedSession("mid", "/dir", now + 2000)

    const result = await listSessionsFromDB("/dir")
    expect(result.map((s) => s.id)).toEqual(["new", "mid", "old"])
  })
})

describe("getSessionFromDB", () => {
  test("returns session by id", async () => {
    await seedSession("ses-1", "/dir")
    const result = await getSessionFromDB("ses-1")
    expect(result).not.toBeNull()
    expect(result?.id).toBe("ses-1")
    expect(result?.title).toBe("Session ses-1")
  })

  test("returns null for non-existent session", async () => {
    expect(await getSessionFromDB("nope")).toBeNull()
  })
})

describe("getMessagesFromDB", () => {
  test("returns messages with parts joined", async () => {
    await seedSession("ses-1", "/dir")
    await seedMessage("msg-1", "ses-1", "user", now)
    await seedPart("p-1", "msg-1", "ses-1", "text", { content: "hello" }, now)

    const result = await getMessagesFromDB("ses-1")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("msg-1")
    expect(result[0].role).toBe("user")
    expect(result[0].parts).toHaveLength(1)
    expect(result[0].parts[0].type).toBe("text")
    expect((result[0].parts[0] as any).content).toBe("hello")
  })

  test("returns empty array for session with no messages", async () => {
    await seedSession("ses-empty", "/dir")
    expect(await getMessagesFromDB("ses-empty")).toEqual([])
  })

  test("messages ordered by timeCreated ascending", async () => {
    await seedSession("ses-1", "/dir")
    await seedMessage("msg-b", "ses-1", "assistant", now + 1000)
    await seedMessage("msg-a", "ses-1", "user", now)

    const result = await getMessagesFromDB("ses-1")
    expect(result.map((m) => m.id)).toEqual(["msg-a", "msg-b"])
  })

  test("multiple parts grouped to correct message", async () => {
    await seedSession("ses-1", "/dir")
    await seedMessage("msg-1", "ses-1", "assistant", now)
    await seedPart("p-1", "msg-1", "ses-1", "text", { content: "hi" }, now)
    await seedPart("p-2", "msg-1", "ses-1", "tool", { toolName: "read" }, now + 1)

    const result = await getMessagesFromDB("ses-1")
    expect(result[0].parts).toHaveLength(2)
  })
})

describe("getMessagesPaginated", () => {
  test("returns limited messages with hasMore flag", async () => {
    await seedSession("ses-1", "/dir")
    for (let i = 0; i < 5; i++) {
      await seedMessage(`msg-${i}`, "ses-1", "user", now + i * 1000)
    }

    const result = await getMessagesPaginated("ses-1", 3)
    expect(result.messages).toHaveLength(3)
    expect(result.hasMore).toBe(true)
  })

  test("hasMore is false when all messages fit", async () => {
    await seedSession("ses-1", "/dir")
    await seedMessage("msg-1", "ses-1", "user", now)
    await seedMessage("msg-2", "ses-1", "user", now + 1000)

    const result = await getMessagesPaginated("ses-1", 10)
    expect(result.messages).toHaveLength(2)
    expect(result.hasMore).toBe(false)
  })

  test("cursor-based pagination with before parameter", async () => {
    await seedSession("ses-1", "/dir")
    for (let i = 0; i < 5; i++) {
      await seedMessage(`msg-${i}`, "ses-1", "user", now + i * 1000)
    }

    const page1 = await getMessagesPaginated("ses-1", 2)
    expect(page1.messages).toHaveLength(2)
    expect(page1.hasMore).toBe(true)

    const oldestInPage1 = page1.messages[0].id
    const page2 = await getMessagesPaginated("ses-1", 2, oldestInPage1)
    expect(page2.messages.length).toBeGreaterThan(0)

    const allIds = [...page2.messages.map((m) => m.id), ...page1.messages.map((m) => m.id)]
    expect(new Set(allIds).size).toBe(allIds.length)
  })
})

describe("getMessageCount", () => {
  test("returns count of messages in session", async () => {
    await seedSession("ses-1", "/dir")
    await seedMessage("msg-1", "ses-1", "user", now)
    await seedMessage("msg-2", "ses-1", "assistant", now + 1000)

    expect(await getMessageCount("ses-1")).toBe(2)
  })

  test("returns 0 for session with no messages", async () => {
    await seedSession("ses-1", "/dir")
    expect(await getMessageCount("ses-1")).toBe(0)
  })
})

describe("getTodosFromDB", () => {
  test("returns todos ordered by position", async () => {
    await seedSession("ses-1", "/dir")
    await db.insert(todos).values([
      { sessionId: "ses-1", position: 1, content: "Second", status: "pending", timeCreated: now, timeUpdated: now },
      { sessionId: "ses-1", position: 0, content: "First", status: "completed", timeCreated: now, timeUpdated: now },
    ])

    const result = await getTodosFromDB("ses-1")
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("First")
    expect(result[0].status).toBe("completed")
    expect(result[1].content).toBe("Second")
  })

  test("returns empty array when no todos", async () => {
    await seedSession("ses-1", "/dir")
    expect(await getTodosFromDB("ses-1")).toEqual([])
  })
})

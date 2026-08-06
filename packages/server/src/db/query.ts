import { eq, desc, asc } from "drizzle-orm"
import { db } from "./index"
import { sessions, messages, parts, todos, repos } from "./schema"

// ---------------------------------------------------------------------------
// DB read layer — returns shapes matching the OpenCode API contract so the
// frontend sees the same data regardless of source (live process vs DB).
// ---------------------------------------------------------------------------

export async function getRepoDirectory(repoId: string): Promise<string | null> {
  const [repo] = await db.select({ localPath: repos.localPath }).from(repos).where(eq(repos.id, repoId))
  return repo?.localPath ?? null
}

export async function listSessionsFromDB(directory: string) {
  const rows = await db.select().from(sessions)
    .where(eq(sessions.directory, directory))
    .orderBy(desc(sessions.timeUpdated))

  return rows.map(sessionRowToApi)
}

export async function getSessionFromDB(sessionId: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!row) return null
  return sessionRowToApi(row)
}

export async function getMessagesFromDB(sessionId: string) {
  const msgRows = await db.select().from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.timeCreated))

  if (msgRows.length === 0) return []

  const partRows = await db.select().from(parts)
    .where(eq(parts.sessionId, sessionId))
    .orderBy(asc(parts.timeCreated))

  const partsByMessage = new Map<string, typeof partRows>()
  for (const part of partRows) {
    const list = partsByMessage.get(part.messageId) ?? []
    list.push(part)
    partsByMessage.set(part.messageId, list)
  }

  return msgRows.map((msg) => {
    const msgParts = partsByMessage.get(msg.id) ?? []
    return {
      id: msg.id,
      role: msg.role,
      parts: msgParts.map((p) => ({
        id: p.id,
        type: p.type,
        ...(p.data as Record<string, unknown>),
      })),
      info: {
        agent: msg.agent ?? undefined,
        providerID: msg.provider ?? undefined,
        modelID: msg.model ?? undefined,
        variant: msg.variant ?? undefined,
      },
      cost: msg.cost ?? undefined,
      time: { created: msg.timeCreated, updated: msg.timeUpdated },
    }
  })
}

export async function getTodosFromDB(sessionId: string) {
  const rows = await db.select().from(todos)
    .where(eq(todos.sessionId, sessionId))
    .orderBy(asc(todos.position))

  return rows.map((row) => ({
    content: row.content,
    status: row.status,
    priority: row.priority ?? undefined,
  }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SessionRow = typeof sessions.$inferSelect

function sessionRowToApi(row: SessionRow) {
  return {
    id: row.id,
    title: row.title || undefined,
    parentID: row.parentId ?? undefined,
    issueId: row.issueId ?? undefined,
    agent: row.agent ?? undefined,
    model: row.model ?? undefined,
    directory: row.directory ?? undefined,
    cost: row.cost,
    tokens: {
      input: row.tokensInput,
      output: row.tokensOutput,
      reasoning: row.tokensReasoning,
      cache: { read: row.tokensCacheRead, write: row.tokensCacheWrite },
    },
    completedAt: row.completedAt ?? undefined,
    time: { created: row.timeCreated, updated: row.timeUpdated },
  }
}

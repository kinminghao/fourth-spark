import { eq, desc, asc, lt, and, or, inArray, count } from "drizzle-orm"
import { db } from "./index"
import { sessions, messages, parts, todos, repos, sessionLinks, issues, pullRequests } from "./schema"

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

  const partsByMessage = new Map<string, PartRow[]>()
  for (const part of partRows) {
    const list = partsByMessage.get(part.messageId) ?? []
    list.push(part)
    partsByMessage.set(part.messageId, list)
  }

  return msgRows.map((msg) => formatMessageRow(msg, partsByMessage.get(msg.id) ?? []))
}

type MessageRow = typeof messages.$inferSelect
type PartRow = typeof parts.$inferSelect

function formatMessageRow(msg: MessageRow, msgParts: PartRow[]) {
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
}

export async function getMessagesPaginated(
  sessionId: string,
  limit: number,
  before?: string,
) {
  let cursorTime: number | undefined
  let cursorId: string | undefined
  if (before) {
    const [cursor] = await db.select({ timeCreated: messages.timeCreated, id: messages.id })
      .from(messages).where(eq(messages.id, before))
    cursorTime = cursor?.timeCreated
    cursorId = cursor?.id
  }

  const cursorCondition = cursorTime != null && cursorId != null
    ? or(
        lt(messages.timeCreated, cursorTime),
        and(eq(messages.timeCreated, cursorTime), lt(messages.id, cursorId)),
      )
    : undefined
  const condition = cursorCondition
    ? and(eq(messages.sessionId, sessionId), cursorCondition)
    : eq(messages.sessionId, sessionId)

  const msgRows = await db.select().from(messages)
    .where(condition)
    .orderBy(desc(messages.timeCreated), desc(messages.id))
    .limit(limit + 1)

  const hasMore = msgRows.length > limit
  if (hasMore) msgRows.pop()
  msgRows.reverse()

  const msgIds = msgRows.map((m) => m.id)
  const partRows = msgIds.length > 0
    ? await db.select().from(parts)
        .where(inArray(parts.messageId, msgIds))
        .orderBy(asc(parts.timeCreated))
    : []

  const partsByMessage = new Map<string, PartRow[]>()
  for (const part of partRows) {
    const list = partsByMessage.get(part.messageId) ?? []
    list.push(part)
    partsByMessage.set(part.messageId, list)
  }

  const [{ value: total }] = await db.select({ value: count() })
    .from(messages).where(eq(messages.sessionId, sessionId))

  return {
    messages: msgRows.map((msg) => formatMessageRow(msg, partsByMessage.get(msg.id) ?? [])),
    total,
    hasMore,
  }
}

export async function getMessageCount(sessionId: string): Promise<number> {
  const [{ value }] = await db.select({ value: count() })
    .from(messages).where(eq(messages.sessionId, sessionId))
  return value
}

// ---------------------------------------------------------------------------
// Session snapshot — batch query for session + status + todos + links
// ---------------------------------------------------------------------------

export async function getSessionLinksFromDB(sessionId: string) {
  const links = await db.select().from(sessionLinks).where(eq(sessionLinks.sessionId, sessionId))

  const issueIds = links.filter((l) => l.type === "issue").map((l) => l.targetId)
  const prIds = links.filter((l) => l.type === "pr").map((l) => l.targetId)

  const linkedIssues = issueIds.length > 0
    ? await db.select().from(issues).where(inArray(issues.id, issueIds))
    : []
  const linkedPrs = prIds.length > 0
    ? await db.select().from(pullRequests).where(inArray(pullRequests.id, prIds))
    : []

  return { issues: linkedIssues, pullRequests: linkedPrs }
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

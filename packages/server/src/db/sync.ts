import { eq } from "drizzle-orm"
import { db } from "./index"
import { sessions, messages, parts, todos } from "./schema"
import { logger } from "../middleware/logger"

type R = Record<string, unknown>

function asRecord(v: unknown): R | null {
  return v && typeof v === "object" ? (v as R) : null
}

function getProps(data: R): R | null {
  return asRecord("properties" in data ? data.properties : data)
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback
}

function resolveType(eventName: string, data: R): string {
  if (eventName !== "message" && eventName !== "") return eventName
  return str(data.type, eventName)
}

async function upsertSession(props: R): Promise<void> {
  const id = str(props.id)
  if (!id) return
  const now = Date.now()
  const values = {
    id,
    parentId: str(props.parent_id || props.parentID) || null,
    title: str(props.title),
    agent: str(props.agent) || null,
    model: asRecord(props.model),
    directory: str(props.directory) || null,
    cost: num(props.cost),
    tokensInput: num(props.tokens_input || (props.tokens as R)?.input),
    tokensOutput: num(props.tokens_output || (props.tokens as R)?.output),
    tokensReasoning: num(props.tokens_reasoning || (props.tokens as R)?.reasoning),
    tokensCacheRead: num(props.tokens_cache_read || ((props.tokens as R)?.cache as R)?.read),
    tokensCacheWrite: num(props.tokens_cache_write || ((props.tokens as R)?.cache as R)?.write),
    timeCreated: num((props.time as R)?.created, now),
    timeUpdated: num((props.time as R)?.updated, now),
  }
  const { id: _, timeCreated: __, ...updateSet } = values
  await db.insert(sessions).values(values).onConflictDoUpdate({ target: sessions.id, set: updateSet })
}

async function upsertMessage(sessionId: string, props: R): Promise<void> {
  const id = str(props.id)
  if (!id) return
  const now = Date.now()
  const model = props.model as R | undefined
  const values = {
    id,
    sessionId,
    role: str(props.role, "assistant"),
    agent: str(props.agent) || null,
    model: str(model?.modelID || props.modelID) || null,
    provider: str(model?.providerID || props.providerID) || null,
    variant: str(model?.variant || props.variant) || null,
    cost: typeof props.cost === "number" ? props.cost : null,
    timeCreated: num((props.time as R)?.created, now),
    timeUpdated: num((props.time as R)?.updated, now),
  }
  const { id: _, timeCreated: __, ...updateSet } = values
  await db.insert(messages).values(values).onConflictDoUpdate({ target: messages.id, set: updateSet })
}

async function upsertPart(sessionId: string, messageId: string, props: R): Promise<void> {
  const id = str(props.id)
  if (!id || !messageId) return
  const now = Date.now()
  const partType = str(props.type)
  const { id: _, type: __, ...data } = props
  await db.insert(parts).values({
    id,
    messageId,
    sessionId,
    type: partType,
    data: data as Record<string, unknown>,
    timeCreated: num((props.time as R)?.created, now),
    timeUpdated: num((props.time as R)?.updated, now),
  }).onConflictDoUpdate({
    target: parts.id,
    set: {
      data: data as Record<string, unknown>,
      timeUpdated: num((props.time as R)?.updated, now),
    },
  })
}

async function upsertTodos(sessionId: string, items: unknown[]): Promise<void> {
  if (!sessionId || items.length === 0) return
  const now = Date.now()
  await db.delete(todos).where(eq(todos.sessionId, sessionId))
  const values = items.map((item, i) => {
    const r = asRecord(item)
    return {
      sessionId,
      position: i,
      content: str(r?.content),
      status: str(r?.status, "pending"),
      priority: str(r?.priority, "medium"),
      timeCreated: now,
      timeUpdated: now,
    }
  })
  await db.insert(todos).values(values)
}

async function ensureSession(sessionId: string): Promise<void> {
  const now = Date.now()
  await db.insert(sessions).values({
    id: sessionId,
    title: "",
    timeCreated: now,
    timeUpdated: now,
  }).onConflictDoNothing()
}

async function ensureMessage(sessionId: string, messageId: string): Promise<void> {
  const now = Date.now()
  await db.insert(messages).values({
    id: messageId,
    sessionId,
    role: "assistant",
    timeCreated: now,
    timeUpdated: now,
  }).onConflictDoNothing()
}

export function syncSessionsList(items: unknown[]): void {
  const run = async () => {
    for (const item of items) {
      const r = asRecord(item)
      if (r && typeof r.id === "string") await upsertSession(r)
    }
  }
  run().catch((err) => logger.error({ err }, "sync sessions list failed"))
}

export function syncMessagesList(sessionId: string, items: unknown[]): void {
  const run = async () => {
    await ensureSession(sessionId)
    for (const item of items) {
      const r = asRecord(item)
      if (!r) continue
      const info = asRecord(r.info)
      const msgProps = info && typeof info.id === "string" ? info : r
      if (typeof msgProps.id === "string") {
        await upsertMessage(sessionId, msgProps)
      }
      const partsList = Array.isArray(r.parts) ? r.parts : []
      for (const p of partsList) {
        const part = asRecord(p)
        if (part && typeof part.id === "string" && typeof part.type === "string") {
          const msgId = str(part.messageID || msgProps.id)
          await ensureMessage(sessionId, msgId)
          await upsertPart(sessionId, msgId, part)
        }
      }
    }
  }
  run().catch((err) => logger.error({ err, sessionId }, "sync messages list failed"))
}

export function syncSseEvent(sessionId: string, eventName: string, raw: string): void {
  let data: R
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }

  const type = resolveType(eventName, data)
  const props = getProps(data)
  if (!props) return

  const run = async () => {
    switch (type) {
      case "session.updated": {
        await upsertSession(props)
        break
      }
      case "message.updated": {
        const info = asRecord(props.info)
        const msgProps = info && typeof info.id === "string"
          ? { ...info, ...(Array.isArray(props.parts) ? { parts: props.parts } : {}) }
          : props
        if (typeof msgProps.id === "string") {
          await ensureSession(sessionId)
          await upsertMessage(sessionId, msgProps)
        }
        break
      }
      case "message.part.updated":
      case "message.part.delta": {
        const part = asRecord(props.part) ?? props
        const messageId = str(props.messageID || props.messageId || part.messageID || part.messageId)
        if (part.type && part.id && messageId) {
          await ensureSession(sessionId)
          await ensureMessage(sessionId, messageId)
          await upsertPart(sessionId, messageId, part)
        }
        break
      }
      case "todo.updated": {
        const items = Array.isArray(props) ? props
          : Array.isArray(props.todos) ? props.todos as unknown[]
          : []
        if (items.length > 0) {
          await ensureSession(sessionId)
          await upsertTodos(sessionId, items)
        }
        break
      }
    }
  }

  run().catch((err) => {
    logger.error({ err, type, sessionId }, "sync write failed")
  })
}

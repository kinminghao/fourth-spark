import { pgTable, text, real, bigint, integer, jsonb, timestamp, primaryKey, index } from "drizzle-orm/pg-core"

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  title: text("title").notNull().default(""),
  agent: text("agent"),
  model: jsonb("model").$type<{ providerID?: string; modelID?: string; variant?: string }>(),
  directory: text("directory"),
  cost: real("cost").notNull().default(0),
  tokensInput: bigint("tokens_input", { mode: "number" }).notNull().default(0),
  tokensOutput: bigint("tokens_output", { mode: "number" }).notNull().default(0),
  tokensReasoning: bigint("tokens_reasoning", { mode: "number" }).notNull().default(0),
  tokensCacheRead: bigint("tokens_cache_read", { mode: "number" }).notNull().default(0),
  tokensCacheWrite: bigint("tokens_cache_write", { mode: "number" }).notNull().default(0),
  userId: text("user_id"),
  timeCreated: bigint("time_created", { mode: "number" }).notNull(),
  timeUpdated: bigint("time_updated", { mode: "number" }).notNull(),
}, (t) => [
  index("sessions_user_idx").on(t.userId),
  index("sessions_time_created_idx").on(t.timeCreated),
])

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  agent: text("agent"),
  model: text("model"),
  provider: text("provider"),
  variant: text("variant"),
  cost: real("cost"),
  timeCreated: bigint("time_created", { mode: "number" }).notNull(),
  timeUpdated: bigint("time_updated", { mode: "number" }).notNull(),
}, (t) => [
  index("messages_session_idx").on(t.sessionId, t.timeCreated),
])

export const parts = pgTable("parts", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  data: jsonb("data").notNull().$type<Record<string, unknown>>(),
  timeCreated: bigint("time_created", { mode: "number" }).notNull(),
  timeUpdated: bigint("time_updated", { mode: "number" }).notNull(),
}, (t) => [
  index("parts_message_idx").on(t.messageId),
  index("parts_session_idx").on(t.sessionId),
])

export const todos = pgTable("todos", {
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull(),
  priority: text("priority").notNull().default("medium"),
  timeCreated: bigint("time_created", { mode: "number" }).notNull(),
  timeUpdated: bigint("time_updated", { mode: "number" }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.sessionId, t.position] }),
])

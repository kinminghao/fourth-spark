import { pgTable, text, real, bigint, integer, jsonb, timestamp, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core"

export const repos = pgTable("repos", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  gitUrl: text("git_url").notNull(),
  localPath: text("local_path").notNull(),
  runtimeType: text("runtime_type").default("opencode"),
  port: integer("port"),
  status: text("status").notNull().default("inactive"),
  worktreeEnabled: integer("worktree_enabled").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (t) => [
  uniqueIndex("repos_local_path_idx").on(t.localPath),
])

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  repoId: text("repo_id").notNull().references(() => repos.id, { onDelete: "cascade" }),
  branch: text("branch").notNull(),
  localPath: text("local_path").notNull(),
  baseBranch: text("base_branch").notNull().default("main"),
  status: text("status").notNull().default("active"),
  port: integer("port"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (t) => [
  index("workspaces_repo_idx").on(t.repoId),
  uniqueIndex("workspaces_local_path_idx").on(t.localPath),
  index("workspaces_status_idx").on(t.repoId, t.status),
])

export const milestones = pgTable("milestones", {
  id: text("id").primaryKey(),
  repoId: text("repo_id").notNull().references(() => repos.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  state: text("state").notNull().default("open"),
  dueOn: bigint("due_on", { mode: "number" }),
  openIssues: integer("open_issues").notNull().default(0),
  closedIssues: integer("closed_issues").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (t) => [
  uniqueIndex("milestones_repo_number_idx").on(t.repoId, t.number),
  index("milestones_repo_idx").on(t.repoId),
])

export const issues = pgTable("issues", {
  id: text("id").primaryKey(),
  repoId: text("repo_id").notNull().references(() => repos.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  state: text("state").notNull().default("open"),
  labels: jsonb("labels").$type<Array<{ id: number; name: string; color: string }>>(),
  milestoneId: text("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
  htmlUrl: text("html_url"),
  authorLogin: text("author_login"),
  authorAvatar: text("author_avatar"),
  assignees: jsonb("assignees").$type<Array<{ login: string; avatar_url: string }>>(),
  commentCount: integer("comment_count").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (t) => [
  uniqueIndex("issues_repo_number_idx").on(t.repoId, t.number),
  index("issues_repo_state_idx").on(t.repoId, t.state),
  index("issues_parent_idx").on(t.parentId),
  index("issues_milestone_idx").on(t.milestoneId),
])

export const promptFragments = pgTable("prompt_fragments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  content: text("content").notNull().default(""),
  repoId: text("repo_id").references(() => repos.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (t) => [
  index("prompt_fragments_repo_idx").on(t.repoId),
])

export const customAgents = pgTable("custom_agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseAgent: text("base_agent").notNull(),
  model: text("model"),
  systemPrompt: text("system_prompt").notNull().default(""),
  systemPromptPosition: integer("system_prompt_position").notNull().default(-1),
  isSystem: integer("is_system").notNull().default(0),
  repoId: text("repo_id").references(() => repos.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (t) => [
  index("custom_agents_repo_idx").on(t.repoId),
])

export const customAgentFragments = pgTable("custom_agent_fragments", {
  customAgentId: text("custom_agent_id").notNull().references(() => customAgents.id, { onDelete: "cascade" }),
  fragmentId: text("fragment_id").notNull().references(() => promptFragments.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.customAgentId, t.fragmentId] }),
])

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  issueId: text("issue_id").references(() => issues.id, { onDelete: "set null" }),
  customAgentId: text("custom_agent_id").references(() => customAgents.id, { onDelete: "set null" }),
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
  completedAt: bigint("completed_at", { mode: "number" }),
  timeCreated: bigint("time_created", { mode: "number" }).notNull(),
  timeUpdated: bigint("time_updated", { mode: "number" }).notNull(),
}, (t) => [
  index("sessions_user_idx").on(t.userId),
  index("sessions_time_created_idx").on(t.timeCreated),
  index("sessions_workspace_idx").on(t.workspaceId),
  index("sessions_issue_idx").on(t.issueId),
  index("sessions_custom_agent_idx").on(t.customAgentId),
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

export const agentMemories = pgTable("agent_memories", {
  id: text("id").primaryKey(),
  customAgentId: text("custom_agent_id").notNull().references(() => customAgents.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  mergedFrom: jsonb("merged_from").$type<string[]>(),
  content: text("content").notNull(),
  category: text("category").notNull().default("general"),
  importance: real("importance").notNull().default(0.5),
  supersededBy: text("superseded_by"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (t) => [
  index("agent_memories_agent_idx").on(t.customAgentId),
  index("agent_memories_category_idx").on(t.customAgentId, t.category),
  index("agent_memories_active_idx").on(t.customAgentId, t.importance),
])

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
})

export const gitHosts = pgTable("git_hosts", {
  id: text("id").primaryKey(),
  host: text("host").notNull(),
  platform: text("platform").notNull().default("gitea"),
  name: text("name").notNull(),
  token: text("token").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (t) => [
  uniqueIndex("git_hosts_host_idx").on(t.host),
])

export const issueComments = pgTable("issue_comments", {
  id: text("id").primaryKey(),
  issueId: text("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
  repoId: text("repo_id").notNull().references(() => repos.id, { onDelete: "cascade" }),
  authorLogin: text("author_login").notNull(),
  authorAvatar: text("author_avatar"),
  body: text("body").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (t) => [
  index("issue_comments_issue_idx").on(t.issueId),
  index("issue_comments_repo_idx").on(t.repoId),
])

export const tags = pgTable("tags", {
  id: text("id").primaryKey(),
  repoId: text("repo_id").notNull().references(() => repos.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("6b7280"),
  description: text("description"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (t) => [
  uniqueIndex("tags_repo_name_idx").on(t.repoId, t.name),
  index("tags_repo_idx").on(t.repoId),
])

export const issueTags = pgTable("issue_tags", {
  issueId: text("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.issueId, t.tagId] }),
  index("issue_tags_tag_idx").on(t.tagId),
])

export const pullRequests = pgTable("pull_requests", {
  id: text("id").primaryKey(),
  repoId: text("repo_id").notNull().references(() => repos.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  state: text("state").notNull().default("open"),
  headBranch: text("head_branch").notNull(),
  baseBranch: text("base_branch").notNull(),
  labels: jsonb("labels").$type<Array<{ id: number; name: string; color: string }>>(),
  htmlUrl: text("html_url"),
  authorLogin: text("author_login"),
  authorAvatar: text("author_avatar"),
  assignees: jsonb("assignees").$type<Array<{ login: string; avatar_url: string }>>(),
  mergeable: text("mergeable"),
  draft: integer("draft").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  mergedAt: bigint("merged_at", { mode: "number" }),
}, (t) => [
  uniqueIndex("pull_requests_repo_number_idx").on(t.repoId, t.number),
  index("pull_requests_repo_state_idx").on(t.repoId, t.state),
])

export const prIssueLinks = pgTable("pr_issue_links", {
  prId: text("pr_id").notNull().references(() => pullRequests.id, { onDelete: "cascade" }),
  issueId: text("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.prId, t.issueId] }),
  index("pr_issue_links_issue_idx").on(t.issueId),
])

export const deviceTokens = pgTable("device_tokens", {
  id: text("id").primaryKey(),
  token: text("token").notNull(),
  platform: text("platform").notNull().default("ios"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (t) => [
  uniqueIndex("device_tokens_token_idx").on(t.token),
])

export const sessionLinks = pgTable("session_links", {
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "issue" | "pr"
  targetId: text("target_id").notNull(), // issues.id or pullRequests.id
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.sessionId, t.type, t.targetId] }),
  index("session_links_session_idx").on(t.sessionId),
  index("session_links_target_idx").on(t.type, t.targetId),
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

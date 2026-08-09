# 数据持久化

所有业务数据全量存入 PostgreSQL，进程重启不丢失。

## 数据库概览

- **引擎**：PostgreSQL 16 (Alpine)，通过 Docker Compose 运行
- **ORM**：Drizzle ORM，schema 定义在 `packages/server/src/db/schema.ts`
- **迁移**：开发环境用 `drizzle-kit push` 直接推送 schema；生产环境用 `drizzle-kit generate` + SQL 迁移文件

## Schema（18 张表）

### 核心业务表

| 表 | 用途 | 关键字段 |
|----|------|---------|
| `repos` | 注册的 Git 仓库 | name, git_url, local_path, port, status, worktree_enabled |
| `workspaces` | Git Worktree 工作空间 | repo_id, branch, local_path, base_branch, status, port |
| `sessions` | Agent 会话 | title, agent, model (JSON), cost, tokens_*, workspace_id, issue_id, custom_agent_id, completed_at |
| `messages` | 会话消息 | session_id, role, agent, model, provider, variant, cost |
| `parts` | 消息部件 | message_id, session_id, type, data (JSONB) |
| `todos` | 会话 Todo 列表 | session_id, position, content, status, priority |

### Git 平台表

| 表 | 用途 | 关键字段 |
|----|------|---------|
| `issues` | 同步的 Issue | repo_id, parent_id, number, title, body, state, labels (JSONB), milestone_id, assignees (JSONB), comment_count |
| `issue_comments` | Issue 评论 | issue_id, repo_id, author_login, body |
| `pull_requests` | 同步的 PR | repo_id, number, title, state, head_branch, base_branch, labels (JSONB), mergeable, draft, merged_at |
| `milestones` | 同步的里程碑 | repo_id, number, title, state, due_on, open_issues, closed_issues |
| `tags` | 自定义标签 | repo_id, name, color, description |
| `issue_tags` | Issue ↔ 标签关联 | issue_id, tag_id |
| `pr_issue_links` | PR ↔ Issue 关联 | pr_id, issue_id |

### Agent 配置表

| 表 | 用途 | 关键字段 |
|----|------|---------|
| `custom_agents` | 自定义 Agent | name, base_agent, model, system_prompt, system_prompt_position, is_system, repo_id |
| `custom_agent_fragments` | Agent ↔ 片段关联 | custom_agent_id, fragment_id, position |
| `prompt_fragments` | 可复用提示词片段 | name, content, repo_id, sort_order |

### 系统表

| 表 | 用途 | 关键字段 |
|----|------|---------|
| `settings` | 键值配置 | key, value |
| `git_hosts` | Git 平台凭证 | host, platform, name, token |
| `device_tokens` | iOS 推送设备令牌 | token, platform |
| `session_links` | Session ↔ Issue/PR 关联 | session_id, type, target_id |

## 同步机制

### 初始同步

服务启动时，`ProcessManager` 为每个 repo 的 OpenCode 进程执行初始同步：

1. 调用 `client.listSessions()` 获取全部 Session
2. 通过 `syncSessionsList()` 批量 upsert 到 `sessions` 表
3. 遍历每个 Session，调用 `client.getMessages()` 获取消息
4. 通过 `syncMessagesList()` 批量 upsert 到 `messages` + `parts` 表

### 增量同步

运行时通过 SSE 事件驱动增量更新：

- `session.created` → 插入 `sessions`
- `session.updated` → 更新 `sessions`（标题、cost、tokens 等）
- `message.created` / `message.updated` → upsert `messages` + `parts`

### Git 平台同步

Issue / PR / Milestone 通过前端触发同步：

- `POST /api/repos/:repoId/issues/sync` — 从 Git 平台拉取全部 Issue
- `POST /api/repos/:repoId/pulls/sync` — 从 Git 平台拉取全部 PR
- 同步时自动解析 PR body 中的 Issue 引用（`Closes #N`）写入 `pr_issue_links`

## Schema 变更流程

- **开发环境**：修改 `schema.ts` 后服务启动时自动执行 `bunx drizzle-kit push --force`
- **生产环境**：`bunx drizzle-kit generate` 生成 SQL 迁移文件到 `drizzle/` 目录，服务启动时 `db/migrate.ts` 自动应用
- 判断依据：检查 `drizzle.config.ts` 文件是否存在（开发环境有，生产编译后无）

## 索引策略

关键索引一览：

- `repos`: `local_path` 唯一索引（防止重复注册）
- `sessions`: `workspace_id`, `issue_id`, `custom_agent_id`, `time_created` 索引
- `messages`: `(session_id, time_created)` 复合索引
- `parts`: `message_id`, `session_id` 索引
- `issues`: `(repo_id, number)` 唯一索引，`(repo_id, state)` 复合索引，`parent_id`, `milestone_id` 索引
- `pull_requests`: `(repo_id, number)` 唯一索引，`(repo_id, state)` 复合索引
- `tags`: `(repo_id, name)` 唯一索引
- `git_hosts`: `host` 唯一索引
- `device_tokens`: `token` 唯一索引

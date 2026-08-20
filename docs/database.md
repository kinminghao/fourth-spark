# 数据库设计

PostgreSQL 16，通过 Docker 运行，使用 [Drizzle ORM](https://orm.drizzle.team/) 管理 schema。

## 表关系概览

```
repos ─────────────┬──── milestones
  │                │
  ├── workspaces   │
  │                │
  ├── issues ──────┤    ┌── issueComments
  │    │           │    │
  │    ├───────────┼────┘
  │    ├── issueTags ──── tags
  │    └── prIssueLinks ─┐
  │                      │
  ├── pullRequests ──────┘
  │
  ├── sessions ──── messages ──── parts
  │    │
  │    ├── todos
  │    └── sessionLinks
  │
  ├── customAgents ──── customAgentFragments ──── promptFragments
  │    │
  │    └── agentMemories
  │
  └── (promptFragments: repoId nullable → 全局或仓库级)

settings              (全局 KV，无 FK)
gitHosts              (Git 平台凭证，无 FK)
deviceTokens          (iOS 推送 Token，无 FK)
```

## 表定义

### repos — 仓库注册

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | UUID |
| name | text | 显示名称 |
| gitUrl | text | Git 远程 URL |
| localPath | text (unique) | 本地克隆路径 |
| runtimeType | text | 运行时类型，默认 `opencode`，可选 `claude-code` |
| port | integer | 分配的运行时端口（OpenCode 使用） |
| status | text | `active` / `inactive` / `error` |
| worktreeEnabled | integer | 是否启用 Worktree 隔离 (0/1) |
| createdAt | bigint | 创建时间戳 |
| updatedAt | bigint | 更新时间戳 |

### sessions — Agent 会话

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | OpenCode session ID |
| parentId | text | 父会话 ID |
| issueId | text FK→issues | 关联的 Issue |
| customAgentId | text FK→customAgents | 使用的自定义 Agent |
| title | text | 会话标题 |
| agent | text | Agent 名称 |
| model | jsonb | `{providerID, modelID, variant}` |
| directory | text | 工作目录 |
| cost | real | 总花费 (USD) |
| tokensInput | bigint | 输入 Token 数 |
| tokensOutput | bigint | 输出 Token 数 |
| tokensReasoning | bigint | 推理 Token 数 |
| tokensCacheRead | bigint | 缓存读取 Token |
| tokensCacheWrite | bigint | 缓存写入 Token |
| userId | text | 用户标识 |
| completedAt | bigint | 会话完成时间戳 |
| timeCreated | bigint | 创建时间戳 |
| timeUpdated | bigint | 更新时间戳 |

### messages — 消息

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | 消息 ID |
| sessionId | text FK→sessions | 所属会话 |
| role | text | `user` / `assistant` |
| agent | text | Agent 名称 |
| model | text | 模型 ID |
| provider | text | Provider ID |
| variant | text | 变体（如 `max`） |
| cost | real | 本条消息花费 |
| timeCreated | bigint | 创建时间戳 |
| timeUpdated | bigint | 更新时间戳 |

### parts — 消息内容块

每条 message 包含多个 part（文本、工具调用、思考等）。

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | Part ID |
| messageId | text FK→messages | 所属消息 |
| sessionId | text FK→sessions | 所属会话（冗余，便于查询） |
| type | text | `text` / `tool` / `thinking` / `step-finish` 等 |
| data | jsonb | 内容数据（结构因 type 而异） |
| timeCreated | bigint | 创建时间戳 |
| timeUpdated | bigint | 更新时间戳 |

### todos — 会话任务

| 列 | 类型 | 说明 |
|----|------|------|
| sessionId | text FK→sessions | 所属会话 |
| position | integer | 排序位置 |
| content | text | 任务描述 |
| status | text | `pending` / `in_progress` / `completed` / `cancelled` |
| priority | text | `high` / `medium` / `low` |
| timeCreated | bigint | 创建时间戳 |
| timeUpdated | bigint | 更新时间戳 |

> 复合主键：`(sessionId, position)`

### issues — Issue

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | `{repoId}_{number}` |
| repoId | text FK→repos | 所属仓库 |
| parentId | text | 父 Issue ID（Epic/子任务） |
| number | integer | Issue 编号 |
| title | text | 标题 |
| body | text | 正文 (Markdown) |
| state | text | `open` / `closed` |
| labels | jsonb | `[{id, name, color}]` |
| milestoneId | text FK→milestones | 关联的里程碑 |
| htmlUrl | text | 平台 URL |
| authorLogin | text | 作者用户名 |
| authorAvatar | text | 作者头像 |
| assignees | jsonb | `[{login, avatar_url}]` |
| commentCount | integer | 评论数 |
| createdAt | bigint | 创建时间戳 |
| updatedAt | bigint | 更新时间戳 |

### pullRequests — Pull Request

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | `{repoId}_{number}` |
| repoId | text FK→repos | 所属仓库 |
| number | integer | PR 编号 |
| title | text | 标题 |
| body | text | 正文 |
| state | text | `open` / `closed` / `merged` |
| headBranch | text | 源分支 |
| baseBranch | text | 目标分支 |
| labels | jsonb | `[{id, name, color}]` |
| htmlUrl | text | 平台 URL |
| authorLogin | text | 作者 |
| authorAvatar | text | 作者头像 |
| assignees | jsonb | `[{login, avatar_url}]` |
| mergeable | text | 可合并状态 |
| draft | integer | 是否草稿 (0/1) |
| commentCount | integer | 评论数 |
| additions | integer | 新增行数 |
| deletions | integer | 删除行数 |
| changedFilesCount | integer | 变更文件数 |
| commitCount | integer | 提交数 |
| diffStats | jsonb | `[{filename, status, additions, deletions}]` |
| createdAt | bigint | 创建时间戳 |
| updatedAt | bigint | 更新时间戳 |
| mergedAt | bigint | 合并时间戳 |

### milestones — 里程碑

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | `{repoId}_{number}` |
| repoId | text FK→repos | 所属仓库 |
| number | integer | 里程碑编号 |
| title | text | 标题 |
| description | text | 描述 |
| state | text | `open` / `closed` |
| dueOn | bigint | 截止日期 |
| openIssues | integer | 未关闭 Issue 数 |
| closedIssues | integer | 已关闭 Issue 数 |
| createdAt | bigint | 创建时间戳 |
| updatedAt | bigint | 更新时间戳 |

### issueComments — Issue 评论

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | `{repoId}_c{commentId}` |
| issueId | text FK→issues | 所属 Issue |
| repoId | text FK→repos | 所属仓库 |
| authorLogin | text | 评论作者 |
| authorAvatar | text | 作者头像 |
| body | text | 评论正文 |
| createdAt | bigint | 创建时间戳 |
| updatedAt | bigint | 更新时间戳 |

### tags — 自定义标签

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | UUID |
| repoId | text FK→repos | 所属仓库 |
| name | text (unique per repo) | 标签名称 |
| color | text | 颜色 hex（默认 `6b7280`） |
| description | text | 描述 |
| createdAt | bigint | 创建时间戳 |

### issueTags — Issue-标签关联

| 列 | 类型 | 说明 |
|----|------|------|
| issueId | text FK→issues | Issue ID |
| tagId | text FK→tags | 标签 ID |

> 复合主键：`(issueId, tagId)`

### prIssueLinks — PR-Issue 关联

| 列 | 类型 | 说明 |
|----|------|------|
| prId | text FK→pullRequests | PR ID |
| issueId | text FK→issues | Issue ID |

> 复合主键：`(prId, issueId)`

### sessionLinks — 会话关联

| 列 | 类型 | 说明 |
|----|------|------|
| sessionId | text FK→sessions | 会话 ID |
| type | text | `issue` / `pr` |
| targetId | text | issues.id 或 pullRequests.id |
| createdAt | bigint | 创建时间戳 |

> 复合主键：`(sessionId, type, targetId)`

### customAgents — 自定义 Agent

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | UUID |
| name | text | Agent 名称 |
| baseAgent | text | 基于哪个内置 Agent |
| model | text | 指定模型（可选） |
| systemPrompt | text | System prompt 内容 |
| systemPromptPosition | integer | prompt 插入位置（-1 = 末尾） |
| isSystem | integer | 是否系统内置 (0/1) |
| repoId | text FK→repos | 仓库级别（null = 全局） |
| sortOrder | integer | 排序 |
| createdAt | bigint | 创建时间戳 |
| updatedAt | bigint | 更新时间戳 |

### customAgentFragments — Agent-片段关联

| 列 | 类型 | 说明 |
|----|------|------|
| customAgentId | text FK→customAgents | Agent ID |
| fragmentId | text FK→promptFragments | 片段 ID |
| position | integer | 排序位置 |

> 复合主键：`(customAgentId, fragmentId)`

### promptFragments — Prompt 片段

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | UUID |
| name | text | 片段名称 |
| content | text | 片段内容 |
| repoId | text FK→repos | 仓库级别（null = 全局） |
| sortOrder | integer | 排序 |
| createdAt | bigint | 创建时间戳 |
| updatedAt | bigint | 更新时间戳 |

### agentMemories — Agent 记忆

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | `mem_` + 12 位 UUID |
| customAgentId | text FK→customAgents | 所属自定义 Agent |
| sessionId | text FK→sessions | 提取来源会话（可 null） |
| mergedFrom | jsonb | 合并来源 ID 列表 `[string]` |
| content | text | 记忆内容（最长 1000 字符） |
| category | text | 分类：`general` / `decision` / `lesson` / `preference` / `pattern` |
| importance | real | 重要度 0–1（reinforce 操作 ×1.2） |
| supersededBy | text | 被合并后指向新记忆 ID |
| createdAt | bigint | 创建时间戳 |
| updatedAt | bigint | 更新时间戳 |

### settings — 全局设置

| 列 | 类型 | 说明 |
|----|------|------|
| key | text PK | 设置键 |
| value | text | 设置值 |
| updatedAt | bigint | 更新时间戳 |

### gitHosts — Git 平台凭证

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | UUID |
| host | text (unique) | 主机名（如 `github.com`） |
| platform | text | `github` / `gitea` / `gitlab` |
| name | text | 显示名称 |
| token | text | Access Token |
| createdAt | bigint | 创建时间戳 |
| updatedAt | bigint | 更新时间戳 |

### deviceTokens — 推送设备

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | UUID |
| token | text (unique) | APNs 设备 Token |
| platform | text | `ios` |
| createdAt | bigint | 创建时间戳 |
| updatedAt | bigint | 更新时间戳 |

## 索引

除主键外，schema 定义了以下索引：

- `repos_local_path_idx` — 按本地路径唯一查找
- `workspaces_repo_idx` — 按仓库查 workspace
- `workspaces_local_path_idx` — 按本地路径唯一查找
- `workspaces_status_idx` — 按仓库+状态筛选
- `milestones_repo_number_idx` — 按仓库+编号唯一查找
- `milestones_repo_idx` — 按仓库查里程碑
- `issues_repo_number_idx` — 按仓库+编号唯一查找
- `issues_repo_state_idx` — Issue 列表按状态筛选
- `issues_parent_idx` — 子 Issue 查询
- `issues_milestone_idx` — 按里程碑筛选
- `prompt_fragments_repo_idx` — 按仓库查片段
- `custom_agents_repo_idx` — 按仓库查 Agent
- `sessions_user_idx` — 按用户查会话
- `sessions_time_created_idx` — 会话时间排序
- `sessions_workspace_idx` — 按 Workspace 查关联会话
- `sessions_issue_idx` — 按 Issue 查关联会话
- `sessions_custom_agent_idx` — 按自定义 Agent 查会话
- `messages_session_idx` — 按会话+时间查消息
- `parts_message_idx` / `parts_session_idx` — 消息内容查询
- `agent_memories_agent_idx` — 按 Agent 查记忆
- `agent_memories_category_idx` — 按 Agent+分类查记忆
- `agent_memories_active_idx` — 按 Agent+重要度排序
- `issue_comments_issue_idx` / `issue_comments_repo_idx` — 评论查询
- `pull_requests_repo_number_idx` — PR 唯一查找
- `pull_requests_repo_state_idx` — PR 列表按状态筛选
- `tags_repo_name_idx` — 标签唯一性
- `tags_repo_idx` — 按仓库查标签
- `git_hosts_host_idx` — 按主机名唯一查找
- `device_tokens_token_idx` — 设备 Token 去重

## 设计说明

**时间戳用 bigint 而非 timestamp** — 与 OpenCode 的时间格式保持一致（Unix 毫秒），避免时区转换问题。

**ID 用 text 而非 serial** — 大部分 ID 来自 OpenCode（UUID 或 `{repoId}_{number}` 组合键），使用 text 可以直接存储而不需要额外映射。

**jsonb 列存储结构化数据** — labels、assignees、model 等数据结构直接用 jsonb 存储，避免为低频查询的数据创建额外关联表。

**级联删除** — 大部分外键配置了 `onDelete: cascade`，删除仓库时自动清理所有关联数据。Issue 和 CustomAgent 关联的 session 使用 `set null` 保留会话记录。

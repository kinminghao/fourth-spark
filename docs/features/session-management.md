# Session 管理

Session 是 Agent 对话的基本单元。每个 Session 绑定一个仓库，可关联 Issue / PR，支持指定 Custom Agent 和模型。

## Session 生命周期

```
创建 → busy (Agent 运行中) → idle (完成) → [归档/删除]
                ↓
            retry (遇到错误/限额)
                ↓
        [自动恢复 / 账号切换]
```

### 状态

| 状态 | 含义 |
|------|------|
| `busy` | Agent 正在执行，SSE 持续推送消息 |
| `idle` | Agent 执行完毕或等待用户输入 |
| `retry` | 遇到错误（如 rate limit），等待重试 |

状态通过 `SessionMonitor` 每 3 秒轮询获取，变化时通过 SSE 推送到前端。

## Session ↔ Issue / PR 关联

### 自动关联

- Agent 通过 MCP 创建 Issue 时，自动将当前 Session 关联到该 Issue
- Agent 通过 MCP 创建 PR 时，自动关联到 PR 和 PR body 中引用的 Issue

### 手动关联

- `POST /api/repos/:repoId/sessions/:id/links` — 添加关联
- `DELETE /api/repos/:repoId/sessions/:id/links` — 移除关联
- 关联类型：`issue` 或 `pr`

### 关联数据

存储在 `session_links` 表：

| 字段 | 说明 |
|------|------|
| `session_id` | Session ID |
| `type` | 关联类型（`issue` / `pr`） |
| `target_id` | 目标 Issue 或 PR 的 ID |

### UI 展示

- Session 右侧边栏显示关联的 Issue 和 PR 列表
- Issue 详情页显示关联的 Session 历史（按 Issue 分组）
- 可通过侧边栏快速新增/移除关联

## Workspace 绑定

- 启用 Worktree 的仓库创建 Session 时，自动创建或复用 Workspace
- Session 的 `workspace_id` 字段记录所属 Workspace
- Workspace 内的 Session 共享同一个 Git 分支和工作目录
- 查询 Workspace 的活跃状态时，检查其下是否有 `busy` 状态的 Session

## Custom Agent 绑定

- 创建 Session 时可指定 Custom Agent（`custom_agent_id` 字段）
- Agent 的 System Prompt 和 Prompt 片段会注入到该 Session 的对话上下文
- Session 列表显示绑定的 Agent 名称

## 模型覆盖

- Session 级别可覆盖默认模型（`model` 字段，存储 `providerID` / `modelID` / `variant`）
- 每条消息发送时也可单独指定模型
- 默认 variant 为 `max`（通过 `DEFAULT_VARIANT` 环境变量配置）

## 父子 Session

- Session 的 `parent_id` 字段支持父子关系
- 用于 Agent 的 `task` 工具创建的子 Session
- SSE 事件流自动追踪子 Session 的消息

## 数据同步

Session 数据双向同步：

1. **OpenCode → PostgreSQL**：`db/sync.ts` 在进程启动时执行初始同步（`syncSessionsList` + `syncMessagesList`），后续通过 SSE 事件增量更新
2. **PostgreSQL → 前端**：前端通过 REST API 查询，通过 SSE 接收实时更新

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/sessions` | 创建 Session（可指定 agent / model / issue / workspace） |
| `GET` | `/sessions` | 列出所有 Session |
| `GET` | `/sessions/status` | 获取所有 Session 的运行状态 |
| `GET` | `/sessions/:id` | 获取单个 Session 详情 |
| `PATCH` | `/sessions/:id` | 更新 Session（标题等） |
| `DELETE` | `/sessions/:id` | 删除 Session |
| `POST` | `/sessions/:id/prompt` | 发送消息 |
| `POST` | `/sessions/:id/abort` | 中止运行 |
| `GET` | `/sessions/:id/messages` | 获取消息列表 |
| `GET` | `/sessions/:id/todos` | 获取 Todo 列表 |
| `GET` | `/sessions/:id/events` | SSE 事件流 |
| `GET` | `/sessions/:id/links` | 获取 Issue/PR 关联 |
| `POST` | `/sessions/:id/links` | 添加关联 |
| `DELETE` | `/sessions/:id/links` | 移除关联 |
| `POST` | `/sessions/:id/questions/reply` | 回答问题 |
| `POST` | `/sessions/:id/questions/reject` | 拒绝回答 |

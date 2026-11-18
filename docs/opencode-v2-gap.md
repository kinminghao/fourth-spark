# OpenCode V1 → V2 差异与迁移评估

> 状态：调研完成，未开始实施
> 日期：2026-11-18
> 范围：Fourth Spark 的 OpenCode 运行时（`packages/server/src/runtimes/opencode/`）与账号/凭证层
> 结论：V2 是独立运行时线，不是版本号升级；全量迁移约 4–6 周，适配层灰度约 2–3 周。

## 1. 版本现状

| 线 | 包 | 最新版 | 发布时间 |
|---|---|---|---|
| V2（主线） | `@opencode/cli` / `@opencode/client` / `@opencode/sdk` | 2.3.2 | 2026-11-18 |
| V1（维护线） | `opencode-ai` / `@opencode-ai/sdk` | 1.19.6 | 2026-11-17 |

- V2.0.0 发布于 2026-09-11；官方文档默认已是 V2，V1 保留独立 CLI 文档。
- 当前代码按 V1 编写：`runtimes/opencode/client.ts` 头部注明端点按 OpenCode v1.18.0；`cli/paths.ts` 的 `MIN_OPENCODE_VERSION` 仍按 V1 版本线校验。
- V1/V2 默认不能并存：两者都使用 `opencode` 命令，V2 安装器会替换 V1 二进制。npm 包名不同，可显式安装两份，但 PATH/命令会冲突。
- 本机 1.18.34 已带一套 `/api/*` 的 V2 预览（内置 UI 使用），但**不是完整 V2 契约**：与官方 2.3.2 相比，预览版缺少 `credential.activate`、session delete/update、form 等，事件数量也不同（88 vs 100）。验收必须以 `@opencode/cli@2.3.2` 为准。

## 2. 结论与工作量

| 方案 | 范围 | 估算 | 风险 |
|---|---|---|---|
| 留在 V1 | 1.18.x → 1.19.6 | 0.5–1 天 | 低 |
| 适配层 + 新 runtime | 新增 `opencode-v2` provider，v2 → 现有 `RuntimeClient`/事件模型 | 2–3 周核心；含凭证/Form/Todo 3–4 周 | 中 |
| 原生 V2 | 前后端消息/事件/UI 全面改写 | 4–6 周；含 OAuth/用量/多账号回归 6–8 周 | 高 |

估算前提：一名熟悉本仓库的工程师；含单元测试与手工回归，不含生产灰度时间。V2 的能力增量（可续传事件、step/tool 细粒度事件、steer/queue、原生多凭证切换）是否值得，需要产品侧确认。

## 3. 硬阻塞（不改无法启动/请求）

### 3.1 认证

- 官方迁移指南说明 V2 使用 HTTP Basic auth；2.3.2 源码在未设置 `OPENCODE_PASSWORD` 时生成随机密码并打印。`OPENCODE_SERVER_PASSWORD` 仍兼容，`OPENCODE_SERVER_USERNAME` 不再支持，用户名固定为 `opencode`。
- 当前 `provider.ts` 的 `spawnOpenCode()` 未设置密码，`client.ts` 的所有 `fetch` 也未带 `Authorization`，V2 下会全部 401。
- 需要：启动时注入 `OPENCODE_PASSWORD`；在 `HttpRuntimeClient` 的 fetcher 统一加 Basic auth；不建议解析日志中的随机密码。

### 3.2 启动参数与就绪探测

- `spawnOpenCode()` 当前参数：`opencode serve --port ... --hostname 127.0.0.1 --print-logs --log-level DEBUG`。
- V2 移除了 `--log-level`（改用 `OPENCODE_LOG_LEVEL`）和 `--mdns`；`--port` 变为可选，不传时使用随机端口。当前显式传 `--port`，端口部分不受影响，但 `--log-level` 可能导致启动失败，需要移除。
- `waitForReady()` 轮询 `GET /agent`；V2 没有 `/agent`，只有 `/api/agent`（且需认证），会一直等到超时。应改 `GET /api/info` 或 `GET /api/location`。

### 3.3 API 代际与响应形状

- V1：`/session/*`、`/event`、`/agent`、`/provider`、`/question`、`/instance/dispose`。
- V2：统一 `/api/*`，多数响应包成 `{ data: ... }`，部分列表带 `cursor`。
- 目录参数：V1 统一 `?directory=`；V2 中 `/api/session` 列表仍用 `directory`，但 `/api/agent`、`/api/model`、`/api/provider` 使用 `?location[directory]=`（deepObject）。`withDirectory()` 需要按端点区分。

### 3.4 凭证存储

- V1：`~/.local/share/opencode/auth.json`（`lib/auth-files.ts` 的 `AUTH_JSON_CANDIDATES`）。
- V2：SQLite `opencode.db` 的 `credential` 表；`auth.json` 仅在迁移时导入一次，之后继续写 auth.json 不会生效。
- V2 提供 `POST /api/credential`、`POST /api/credential/{id}/activate`、`PATCH/DELETE /api/credential/{id}`，原生支持多凭证与 active 切换，比当前写 auth.json 更干净；但 `credential.ts`、`lib/account-providers/auth-json.ts`、OAuth/用量逻辑都要改。
- 凭证变更后的实例刷新：V1 的链路是 `lib/credential-refresh.ts` → `provider.refreshCredentials()` → `client.disposeInstance()` → `POST /instance/dispose`；V2 对应 `POST /api/location/reload`，改 `client.ts` 的 `disposeInstance()` 实现即可。

## 4. 端点映射

| 现有 V1（`client.ts`） | V2 | 影响 |
|---|---|---|
| `GET /session` | `GET /api/session` | `{data,cursor}`；分页/信封 |
| `POST /session` | `POST /api/session` | 支持 `title/agent/model/location/parentID/permissions`；信封 |
| `GET /session/{id}` | `GET /api/session/{id}` | 信封 |
| `DELETE /session/{id}` | `DELETE /api/session/{id}` | V2.3.2 支持；1.18.34 预览不支持 |
| `GET /session/{id}/message` | `GET /api/session/{id}/message` | `Session.Message.Info` + `cursor`；消息模型重写 |
| `POST /session/{id}/prompt_async` | `POST /api/session/{id}/prompt` | `text/files/agents/skills/delivery`；agent/model 先走 `switchAgent`/`switchModel`；异步 admit |
| `POST /session/{id}/abort` | `POST /api/session/{id}/interrupt` | 返回 `{interrupted}` |
| `GET /session/{id}/todo` | 无 | Todo 功能缺口（见 6.1） |
| `GET /session/status` | 无；`GET /api/session/active` + `session.status`/`session.idle` 事件 | 轮询模型重写 |
| `GET /question` + reply/reject | `GET/POST /api/session/{id}/form` + `/form/{formID}/reply` + `form.*` 事件 | Question UI 重写 |
| `GET /agent` | `GET /api/agent?location[directory]=` | 信封 + deepObject |
| `GET /provider` | `GET /api/provider?location[directory]=` | 信封；凭证来源变 SQLite |
| `POST /instance/dispose` | `POST /api/location/reload` | 凭证刷新语义 |
| `POST /session/{id}/revert` | `POST /revert/stage` + `/revert/commit`；`DELETE /revert` 清除 | 三步流程 |
| `GET /event` | `GET /api/event` | SSE `{id,event,data}`；100 个 `V2Event` 变体 |

补充：V2 的 prompt 不再接受 `parts`、`agent`、`model`、`variant`。`Model.Ref` 仍带 `variant`，所以变体可以通过 `switchModel` 保留；`session.prompt` 返回 `Session.Inbox.User`，是入队/接管语义，不是 V1 的 204。

## 5. 事件与消息模型

- V1：32 种事件，`{ type, properties }`；前端 `global-event-dispatcher.ts` 的 `knownEvents` 只订阅 9 种。
- V2：100 个 `V2Event` 变体（含 `rpc`/`server.connected` 两个连接事件），`{ id, created, type, data }`；`/api/event` 是 SSE，`data` 为 `V2Event`。
- 关键映射：
  - `message.part.updated` / `message.part.delta` → `session.text.delta` / `session.reasoning.delta` / `session.tool.*` / `session.step.*`
  - `todo.updated` → 无
  - `session.status` → `session.status`（同名，payload 变 `data.status`）
  - `session.idle` → `session.idle`
  - `question.*` → `form.created/replied/cancelled`
  - `permission.*` → `permission.asked/replied`
- 消息：V1 `{ info, parts[] }`；V2 `Session.Message.Info` 联合类型，assistant 的 `content[]` 为 text/reasoning/tool，user 为 `text/files/agents/skills`。
- 影响：`db/sync.ts`、`routes/events.ts`、`web/src/lib/sse-events.ts`、`global-event-dispatcher.ts`、`session-store.ts`、`message-parts.ts` 都要改；`session-monitor.ts` 的截断续写/空响应/停滞检测依赖 V1 消息/part 形状，需要重新校准。

## 6. 功能缺口

### 6.1 Todo

V2 没有 `/todo` 接口、没有 `todo.updated` 事件、没有 `Todo` schema。Todo 仅在 `experimental.todo: true` + `todowrite` 工具/TUI 中可用。Fourth Spark 的 Todo 面板需要从工具调用/消息中派生，或暂时下线。这是最明确的功能回退。

### 6.2 Question → Form

V2 用 Form 替代 V1 的 `/question`：`/api/session/{id}/form`（list/create）、`/form/{formID}/reply`、`/form/{formID}`（get/delete），事件为 `form.created/replied/cancelled`。`QuestionPanel.tsx` 的多选、自定义文本、提交/拒绝逻辑要重写。

### 6.3 状态

V2 没有全量 `/session/status` map；`/api/session/active` 只返回 running 会话，idle 需要靠“不在 active 中”推断，或消费 `session.status`/`session.idle` 事件。`session-monitor.ts` 的轮询/状态机要改。

### 6.4 Revert

V1 单步 `revert(messageID, partID?)`；V2 是 stage → commit，清除用 `DELETE /revert`。现有 `revert` 路由/UI 要拆成两步。

### 6.5 配置/插件

- V1 配置格式在 V2 仍被接受（`mcp` 扁平写法也兼容），`opencode.json` MCP 注入大概率可保留。
- `server` 字段在 V2 被忽略；当前代码用 `--port` 显式传端口，不受影响。
- V1 插件在 V2 不运行；Fourth Spark 目前只用 MCP 配置，不用插件，影响小。

## 7. 代码影响面

| 文件 | 职责 | 变化 |
|---|---|---|
| `packages/server/src/runtimes/opencode/client.ts` | V1 HTTP 客户端 | 全量重写为 V2 端点/信封/分页；`disposeInstance()` 改 `/api/location/reload` |
| `packages/server/src/runtimes/opencode/provider.ts` | 进程启动/就绪/端口 | 认证、`--log-level`、`/api/info`、密码 env |
| `packages/server/src/runtimes/opencode/credential.ts` | auth.json 写入 | 改为 `/api/credential` 适配器 |
| `packages/server/src/lib/auth-files.ts` | auth.json 读写 | V1 保留；V2 新增 SQLite/credential 适配 |
| `packages/server/src/lib/account-providers/auth-json.ts` | 凭证适配器 | 新增 V2 实现，保持 `CredentialAdapter` 接口 |
| `packages/server/src/db/sync.ts` | 事件/消息落库 | V2 消息/事件 → `messages`/`parts`/`todos` |
| `packages/server/src/lib/session-monitor.ts` | 状态轮询/续写/重试 | 状态、消息、Todo 读取全部适配 |
| `packages/server/src/routes/events.ts` | SSE 代理/过滤 | 信封、sessionID 提取、事件名 |
| `packages/server/src/routes/sessions/*` | prompt/abort/revert/todo/status | 请求/响应适配 |
| `packages/web/src/lib/sse-events.ts` | SSE 解析 | V2 事件 → 现有 UI 模型 |
| `packages/web/src/lib/global-event-dispatcher.ts` | 事件订阅 | `knownEvents` 改为 V2 事件名 |
| `packages/web/src/stores/session-store.ts` | 会话状态 | 消息/状态/Todo/Question 处理 |
| `packages/web/src/lib/message-parts.ts` | 消息 part 归一化 | `Session.Message.Info` → 现有 part |
| `packages/web/src/components/QuestionPanel.tsx` | Question UI | 改 Form |
| `packages/server/src/cli/paths.ts` | `MIN_OPENCODE_VERSION` | 按 V2 版本线/包名调整 |
| `packages/server/src/lib/config.ts` | 端口/超时/变体 | 端口范围不变；认证 env 新增 |

统计：约 35 个文件、1 万行左右与 OpenCode 行为耦合；实际改动/新增约 2–3k 行（不含测试）。

## 8. 迁移路径

### 方案 A：留在 V1（短期推荐）

- 1.18.34 → 1.19.6，保持 V1 API；验证 `MIN_OPENCODE_VERSION`、账号切换、SSE、Todo/Question。
- 优点：风险最低；V1 仍在维护。缺点：无法获得 V2 能力，迁移债继续累积。

### 方案 B：适配层 + 新 runtime（需要 V2 时推荐）

- 新增 `packages/server/src/runtimes/opencode-v2/`，实现 `RuntimeProvider`/`RuntimeClient`；在适配层把 V2 的 `Session.Message.Info`/100 个 `V2Event` 变体映射回现有 `Message`/`parts`/9 种事件。参考现有 `runtimes/claude-code/event-adapter.ts` 的做法。
- 通过 `RuntimeManager` 的 per-repo runtime 选择灰度：老仓库继续 V1，新仓库/指定仓库走 V2。
- 阶段：
  1. 认证/启动/就绪 + session/prompt/interrupt + `/api/event`。
  2. 消息同步 + 前端渲染适配。
  3. 凭证（`/api/credential` + `/activate`）、Form、Todo 派生、Revert 三步。
- 优点：增量、可回滚、老仓库不受影响。缺点：适配层复杂且可能有损；双 runtime 维护成本。

### 方案 C：原生 V2

- 前后端直接使用 V2 模型/事件/Form/Todo 方案。4–6 周；能力最完整，但风险最高，不建议一次切换。

## 9. 建议的 spike（1–2 天）

在投入迁移前，用 `@opencode/cli@2.3.2` 做隔离验证：

1. 隔离安装，确认 `opencode` 二进制指向 V2（避免与现有 V1 冲突）。
2. 设置 `OPENCODE_PASSWORD`，启动 `opencode serve --hostname 127.0.0.1 --port <空闲端口> --print-logs`。
3. 带 Basic auth 请求 `GET /api/info`，确认就绪探测可用。
4. 创建 session → `switchModel`/`switchAgent` → `prompt` → 订阅 `/api/event`，确认 `session.text.delta`/`session.tool.*`/`session.idle`。
5. `GET /api/session/{id}/message`，确认 `Session.Message.Info` 到现有 `Message`/`parts` 的映射。
6. `POST /api/credential` + `/activate`，确认 `/api/provider` 反映新凭证。
7. 触发 Form → `reply`，确认 `form.*` 事件与 Question UI 的映射。
8. 验证 `opencode.json` 的 V1 扁平 `mcp` 配置仍被接受。
9. 记录真实的 stdout/认证/端口行为，回填本文档的“待验证”项。

## 10. 待验证/风险

- V2 serve 的默认认证行为（官方文档 + 2.3.2 源码表明默认启用；spike 确认具体 build）。
- `--log-level` 在 V2 是硬错误还是被忽略（决定启动失败方式）。
- Form 能否覆盖现有 Question 的全部交互（多选、自定义文本、拒绝/取消）。
- `todowrite` 工具调用是否在 `session.tool.*` 中提供足够信息以重建 Todo 面板。
- `@opencode/cli` 的 integration/OAuth 流程是否覆盖 Fourth Spark 现有 Anthropic/OpenAI/opencode-go 登录方式。
- 老会话历史：在 1.18.34 的 V2 预览上实测，V2 对 V1 会话的消息/历史为空；官方 2.3.2 是否提供兼容读取待 spike 确认。Fourth Spark 的 PostgreSQL 镜像可覆盖 UI，但 `session-monitor`/记忆提取需要双读策略。
- 多账号切换的并发/回滚语义：V2 原生 `active` 切换比 auth.json 好，但仍需验证切换时进行中回合的行为。

## 11. 参考

- 官方迁移指南：<https://opencode.ai/docs/migrate-v1/>
- 官方 V2 OpenAPI：<https://opencode.ai/openapi.json>（142 paths / 173 operations / 518 schemas）
- GitHub Releases：<https://github.com/anomalyco/opencode/releases>（v2.3.2、v1.19.6）
- npm：`@opencode/cli@2.3.2`、`opencode-ai@1.19.6`
- 代码：`packages/server/src/runtimes/opencode/`、`packages/server/src/lib/auth-files.ts`、`packages/server/src/lib/account-providers/`、`packages/server/src/db/sync.ts`、`packages/server/src/lib/session-monitor.ts`、`packages/server/src/routes/events.ts`、`packages/web/src/lib/sse-events.ts`、`packages/web/src/lib/global-event-dispatcher.ts`、`packages/web/src/stores/session-store.ts`、`packages/web/src/lib/message-parts.ts`
- 相关文档：[架构详解](architecture.md)、[Agent 对话](features/agent-conversation.md)、[智能运维](features/smart-ops.md)

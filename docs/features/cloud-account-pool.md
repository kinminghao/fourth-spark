# Cloud 账号池

可选功能 — 多台机器共享账号池。fourth-spark 既可以是 Worker（租用账号），也可以是 Master（内置账号池服务端）。

## 三种角色

| 角色 | 说明 | 账号来源 |
|------|------|---------|
| **本地模式** | 默认模式，使用本机账号文件 | 本机 `claude-accounts.json` + `auth.json` |
| **Worker 模式** | 连接 Master，通过 lease 协议获取账号 | Master 分配 |
| **Master 模式** | `fourth-spark account serve` 启动内置账号池服务端 | 本机账号文件，按 lease 分发给 Worker |

设置页面可一键切换本地 / Worker 模式；Master 模式由 CLI 启动，见下文。

## Worker 模式架构

```
Master (claude-accounts-pool)
    │
    ├── Worker A (fourth-spark 实例 1)  ← lease 账号 X
    ├── Worker B (fourth-spark 实例 2)  ← lease 账号 Y
    └── Worker C (fourth-spark 实例 3)  ← lease 账号 Z
```

每个 Worker 向 Master 租借（lease）一个账号，Master 确保同一账号不会被多个 Worker 同时使用。

## Lease 协议

### 端点

所有请求发往 Master，路由固定：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/v1/lease` | POST | 请求或续约 lease |
| `/v1/ratelimit` | POST | 上报 rate limit |
| `/v1/health` | GET | 健康检查 |
| `/v1/usage` | GET | 查询账号池用量 |

### Lease 请求

```json
{
  "workerId": "fourth-spark-1",
  "reason": "prelease",
  "currentAccountId": "...",
  "preferredAccountIdPrefix": "..."
}
```

- `reason`: `prelease`（预租/续约）或 `ratelimit`（因限额切号）
- `currentAccountId`: 当前持有的账号 ID
- `preferredAccountIdPrefix`: 手动切号时指定目标账号前缀

### Lease 响应

```json
{
  "accountId": "abc123...",
  "access": "eyJ...",
  "expiresAt": 1720000000000
}
```

Worker 收到 lease 后将 access token 写入本地认证文件。

### 失败处理

| HTTP 状态 | 含义 | 处理 |
|-----------|------|------|
| 200 | 成功 | 写入 lease |
| 409 | 拒绝（cooling / needs-reauth / ambiguous） | 不重试 |
| 503 | 无可用账号 | 不重试 |
| 5xx | 服务器错误 | 指数退避重试 |
| 网络错误 | 不可达 | 指数退避重试 |

重试参数：最多 **8 次**，退避从 5 秒起，上限 5 分钟。

## LeaseKeeper

后台定时器，维护 lease 续约：

- 每 **30 秒**检查一次 lease 状态
- 在 access token 过期前 **5 分钟**发起续约
- 续约失败时指数退避重试，但不放弃已有的 lease（仍可用则继续用）
- 服务启动时执行 `startup()` 获取初始 lease

## Rate Limit 上报

遇到 rate limit 时，除了本地切号逻辑，还向 Master 上报：

```json
{
  "workerId": "fourth-spark-1",
  "accountId": "abc123...",
  "headers": {},
  "resetsAt": 1720003600000
}
```

Master 收到后将该账号标记为 cooling，避免分配给其他 Worker。

## Master 模式（pool-only 账号池服务端）

`fourth-spark account serve` 启动一个**独立的 pool-only HTTP 监听器**：只提供 `/v1/*` 池端点与账号文件读取，不启动 DB、Web UI、本地 agent runtime、TLS、migration 或 sync scheduler。因此它可以和主 fourth-spark server **同机并存**。

### 命令

| 命令 | 说明 |
|------|------|
| `fourth-spark account serve [--port PORT] [--host HOST]` | 前台启动；默认 `127.0.0.1:8787` |
| `fourth-spark account start [--port PORT] [--host HOST]` | 后台启动，等待 `/v1/health` 就绪后返回 |
| `fourth-spark account stop` | 停止后台实例；也能通过启动锁定位并停止前台实例 |
| `fourth-spark account status` | 显示池健康、监听地址、各 provider 账号 / 租用 / 需重认证数量 |

- 使用独立的 `~/.fourth-spark/account-pool.lock`，**不与主 server 的 `server.lock` 冲突**；同一数据目录仍只允许一个 pool master。
- 后台实例使用独立的 `account.pid` / `account.port` / `account.log`；pool master 日志写入 `account.log`。
- pool master 启动时如果检测到主 server 正在运行，会在日志中提示「确认主 server 未在本地使用同一批 provider」。
- 账号管理仍由主 server 的 Web UI 负责（同一 HOME / 同一账号文件）；pool master 本身无 UI。

### 端点

| 路由 | 方法 | 说明 |
|------|------|------|
| `/` | GET | `{"name":"fourth-spark account pool","status":"ok"}` |
| `/v1/health` | GET | `{"ok":true}` |
| `/v1/lease` | POST | 领取 / 续约账号 |
| `/v1/ratelimit` | POST | 上报限额，账号进入冷却 |
| `/v1/usage` | GET | 账号与用量快照（`?provider=`，默认 anthropic） |
| `/v1/usage/refresh` | POST | 刷新用量快照；30s 全局节流，429 + `retryAfterMs` |

协议分两版，向后兼容：

- **v1**（无 `protocolVersion`）：只服务 anthropic，响应 `{accountId, access, expiresAt}`；容量耗尽返回 503，保持既有 Worker 客户端兼容。
- **v2**（`protocolVersion: 2`，必须显式 `provider`）：响应增加 `provider`、`credential`（OAuth：`{access, expires, accountId?}`；API Key：`{key}`）与 `leaseExpiresAt`；仅 v2 会返回 `refused: "at-capacity"`。
- 三个 provider 由 descriptor 统一驱动：anthropic / openai 使用 OAuth access（master 独占 refresh 链）；opencode-go 使用静态 key（租约只表示持有权，不改变 key 有效期）。
- **provider 白名单**：`ACCOUNT_POOL_PROVIDERS=anthropic,openai,opencode-go`（逗号分隔，默认全部）。只应启用主 server 未在本地使用的 provider，避免两个进程刷新同一条 refresh 链。
- 当前 Worker 模式仍只以 v1 租用 anthropic；openai / opencode-go 的 Worker 侧接入是后续工作项（#698）。

### 调度与状态

- **选号**：最少持有者 → 排除 cooling / excluded / needsReauth / 租约 sentinel → 在同等持有量中轮转；`currentAccountId` 幂等续租，`preferredAccountIdPrefix` 支持手动点名。用量利用率排序为后续优化。
- **持有上限**：anthropic 3、openai 1、opencode-go 1（见 `packages/server/src/account/constants.ts` 的 `PROVIDER_LIMITS`）。持有者指 fourth-spark 实例，不是会话并发数。
- **租约**：OAuth 账号的 `leaseExpiresAt` 比真实 access 过期早 10 分钟；Worker 仍按 5 分钟窗口续约。opencode-go 使用 4 小时持有 TTL。
- **持久化**：租约簿、冷却、亲和、Worker 名册写入 `~/.fourth-spark/account-pool-state.json`（可用 `ACCOUNT_POOL_STATE_PATH` 覆盖）；master 重启后租约仍然生效。
- **刷新**：master 是它所服务 provider 的唯一刷新者。lease 刷新统一经过 `account/refresh.ts` 的 `withAuthLock` 事务（重新读取 → 刷新 → 原子写回）；master 的用量采集跳过刷新（`collectUsage(..., { skipRefresh: true })`），避免与 lease 抢占 refresh token 轮换。

### 部署约束

- **账号所有权**：master 主机必须持有真实 refresh token。若该机器曾作为 Worker 运行，`claude-accounts.json` 的 refresh 槽可能是租约 sentinel；这些账号会显示「需重新登录」，必须在 master 主机重新登录后才能发号。
- **刷新所有权**：pool master 与主 server 可以同机并存，但同一个 provider 只能有一个本地刷新者。主 server 在本地使用某 provider 时，不要把它加入 `ACCOUNT_POOL_PROVIDERS`；或者让主 server 以 Worker 模式租用该 provider（#698 完成后可按 provider 配置）。
- **账号管理**：pool master 无 UI；在主 server 的「账号」页添加 / 切换 / 删除账号，pool master 直接读取同一份账号文件。
- **独占**：master 不应与外部 `claude-accounts-pool` 同时管理同一份账号文件；同一数据目录只允许一个 pool master（`account-pool.lock`）。
- **安全**：池协议没有应用层认证，绑定地址就是安全边界。默认只绑 `127.0.0.1`；跨机使用需显式 `--host 0.0.0.0` 或具体网卡地址，并放在 Tailscale / 内网 ACL / 反向代理之后。API Key 租约无法随租约到期撤销，轮换 key 会影响所有持有者。
- **依赖**：pool master 不需要 PostgreSQL / OpenCode / git / Docker；只读取账号文件并监听端口。`ACCOUNT_POOL_PORT`（默认 8787）与 `ACCOUNT_POOL_HOST`（默认 127.0.0.1）由 CLI 设置。

## 配置方式

### 数据库配置（推荐）

设置页面填写后存入 `settings` 表：

| 键 | 值示例 |
|----|--------|
| `cloud_master_url` | `http://100.64.0.36:8787` |
| `cloud_worker_id` | `fourth-spark-1` |

### 环境变量配置

| 变量 | 说明 |
|------|------|
| `MASTER_URL` | Master 服务器地址 |
| `WORKER_ID` | 本 Worker 的唯一标识（1–64 字符，字母数字和 `._-`） |

优先级：数据库 > 环境变量。Master 模式（`ACCOUNT_POOL_MASTER=1`）忽略这些配置，不会把自身当作 Worker。

### Worker ID

- 默认取本机 hostname（去掉 `.local` 后缀）
- 建议用小写字母、数字和连字符
- 在 Master 中唯一标识此 Worker

## UI 配置

设置页面"Claude 账号"Tab 提供模式切换：

### 本地模式

- 显示本地所有账号的用量（5 小时窗口 / 7 天窗口）
- 手动切换账号按钮
- 标记排除 / 需重认证的账号

### 账号池模式

- 连接状态指示（已连接 / 未连接）
- 当前 Worker ID 和持有账号显示
- Master URL 和 Worker ID 配置输入框
- 测试连接按钮
- 保存后自动 reload（`POST /api/cloud/reload`）
- 手动切换账号按钮（通过 Master 请求新 lease）

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/cloud/status` | 获取当前模式和连接状态 |
| `POST` | `/api/cloud/reload` | 重新加载账号池配置 |
| `POST` | `/api/cloud/test` | 测试 Master 连接 |
| `POST` | `/api/usage/switch` | 切换账号（本地或通过 Master） |

Master 侧另有 `/v1/health`、`/v1/lease`、`/v1/ratelimit`、`/v1/usage`、`/v1/usage/refresh`，见上文「Master 模式」。

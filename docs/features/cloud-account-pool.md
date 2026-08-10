# Cloud 账号池

可选功能 — 连接 claude-accounts-pool Master 服务器，多台机器共享 Claude 账号池。

## 两种模式

| 模式 | 说明 | 账号来源 |
|------|------|---------|
| **本地模式** | 默认模式，使用本机 `~/.claude/` 目录的账号 | 本地 `accounts.json` |
| **Worker 模式** | 连接远程 Master，通过 lease 协议获取账号 | Master 服务器分配 |

设置页面可一键切换模式。

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

优先级：数据库 > 环境变量。

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

# 智能运维

自动化处理 Agent 运行过程中的各种异常和运维工作，减少人工干预。

## SessionMonitor 核心循环

`SessionMonitor` 每 3 秒轮询所有已注册 repo 的 Session 状态，检测异常并自动处理：

```
poll → 获取 Session 状态 → 检测状态变化
    │
    ├── idle → busy：发送"开始运行"通知
    ├── busy → idle：检查截断 / 空响应 → 自动续写 / 重试
    ├── * → retry：检查是否 rate limit → 自动切号
    └── busy → idle (正常完成)：发送"完成"通知 + 释放账号
```

## 截断自动续写

当 Agent 的响应被截断（输出未包含 `step-finish` 标记）且仍有未完成的 Todo 时：

1. 检查自动续写次数是否达到上限（**最多 5 次**）
2. 检查是否存在 `in_progress` 或 `pending` 的 Todo
3. 检查 Todo 是否停滞（相同 fingerprint 连续出现 **3 次**则判定停滞）
4. 检查是否连续产出短文本无工具调用的空闲响应（连续 **2 次**则停止）
5. 以上检查全部通过后，自动发送 `continue` 指令
6. 保留原 Session 的 agent / model 信息

### 计数器重置

- 检测到新的用户消息时，自动重置所有计数器（续写次数、空闲计数、停滞计数）
- 避免上一轮对话的计数影响下一轮

## 空响应自动重试

当 Agent 返回空响应（assistant 消息的所有 part 都是空文本或只有 thinking）时：

- **最多重试 2 次**
- 自动发送 `continue` 指令
- 重试不触发通知（避免打扰）

## 账号自动轮换

### 触发条件

SessionMonitor 检测到 `retry` 状态且错误消息匹配以下关键词：

```
rate limit | usage limit | limit reached | too many requests
out of usage | out of quota | 5-hour | weekly limit | exceed
```

排除 `overloaded_error`（服务器过载不触发切号）。

### 切号流程

1. 去重检查（同一错误 30 秒内不重复处理）
2. 近期切号保护（5 秒内有切号操作则跳过，直接 reprompt）
3. 将当前账号标记为 cooldown
4. 从账号池获取下一个可用账号
5. 刷新目标账号的 OAuth token（如果过期）
6. 写入 Claude 认证文件
7. 根据进展情况决定 reprompt 策略：
   - 有实质进展（工具调用或文本输出）→ 发送 `continue`
   - 无进展 → 重发原始用户 prompt

### 账号选择策略

- 按顺序轮选（round-robin），跳过当前账号
- 跳过处于 cooldown 的账号
- 跳过被标记为 `excluded` 的账号
- 跳过需要重新认证（`needsReauth`）的账号
- 切换失败时自动尝试下一个候选

### Cooldown 管理

- 从错误消息解析重置时间（如 `5 hour` → 5 小时后）
- 解析不到时标记为"未知期限"cooldown
- Cooldown 状态持久化到 `/tmp/fourth-spark/cooldown.json`（进程重启后恢复）
- 到期后自动解除 cooldown
- 手动切号可立即清除 cooldown

### Token 刷新

- 切换账号前检查目标 token 是否过期（`isStale`）
- 过期则调用 Anthropic OAuth refresh 端点刷新
- 处理 `invalid_grant`（token 被撤销）→ 标记 `needsReauth`
- 并发刷新请求自动去重（同一时刻只有一个 refresh 在飞）
- 刷新失败时检查是否有其他进程已经更新了 token（foreign rotation adoption）

## 用户中止处理

- 用户点击"中止"后，SessionMonitor 标记该 Session 为 `userAborted`
- 后续该 Session 的 `retry` 状态不再触发自动切号
- 新的用户消息会清除 aborted 标记

## 通知系统

### macOS 桌面通知

- 通过 `osascript` 调用系统通知
- 仅在 macOS 平台生效
- 通知内容：Session 开始 / 完成 / 重试 / 账号切换 / 切换失败

### iOS APNs 推送

- JWT 鉴权（ES256 签名，50 分钟缓存）
- 配置项：`APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_KEY_PATH` / `APNS_BUNDLE_ID`
- 支持 Sandbox 和 Production 环境（`APNS_PRODUCTION` 开关）
- 推送 payload 包含 `sessionId`，用于 iOS App 点击跳转
- 设备 token 通过 `POST /api/push/register` 注册
- 收到 APNs 410 响应时自动清理失效的设备 token
- 所有已注册设备并行推送

### 通知去重

- 同一 Session 的通知 30 秒冷却期
- 自动续写和空响应重试不触发通知

## 关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `POLL_INTERVAL_MS` | 3000 | 轮询间隔 |
| `MAX_AUTO_CONTINUES` | 5 | 最大自动续写次数 |
| `MAX_EMPTY_RETRIES` | 2 | 最大空响应重试次数 |
| `MAX_IDLE_RESPONSES` | 2 | 连续空闲响应上限 |
| `MAX_STAGNATION` | 3 | Todo 停滞检测阈值 |
| `DEDUP_COOLDOWN_MS` | 30000 | 去重冷却时间 |
| `NOTIFY_COOLDOWN_MS` | 30000 | 通知冷却时间 |
| `RECENT_SWITCH_GUARD_MS` | 5000 | 近期切号保护时间 |
| `REPROMPT_SETTLE_MS` | 1500 | Abort 后等待稳定时间 |

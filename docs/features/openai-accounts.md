# OpenAI (ChatGPT) 账号

通过 ChatGPT 账号的浏览器 OAuth 或设备码（无头）登录，把凭证写入 opencode 的 `auth.json`，供 opencode runtime 的 `openai` provider（Codex/ChatGPT 模型）使用。实现见 `packages/server/src/lib/account-providers/openai.ts`。

## 凭据模型

- **auth.json 条目**（opencode runtime 直读）：`{"openai": {"type": "oauth", "access": "…", "refresh": "…", "expires": 0, "accountId": "…"}}`
  - `expires` 为毫秒时间戳
  - `accountId` 来自 token 的 JWT claims，opencode 用它设置 `ChatGPT-Account-Id` 请求头；缺少该字段时登录失败，不会生成伪造 id
- **账号记录**（`claude-accounts.json`）：`provider: "openai"`、`accountId` 与刷新令牌一起持久化；`activeIds.openai` 指向当前激活账号
- 账号 id 即 ChatGPT `accountId`；显示标签优先取 token 中的 email，缺失时回退为 `ChatGPT · <accountId 后 6 位>`
- 适配器与端点定义见 `openai.ts`、`auth-json.ts`

## 登录方式

| 方式 | 适用场景 | 特点 |
|------|----------|------|
| **浏览器授权** | 与 fourth-spark 同机 | 一键跳转，无需输入代码；占用固定回调端口（`CALLBACK_PORT`） |
| **设备码（无头）** | 远程、容器、无桌面环境 | 在浏览器输入短码；不需要回调端口，不会占用本机端口 |

浏览器授权：

1. 服务端生成 PKCE verifier/challenge 与 `state`，在回环地址上监听回调端口，返回授权 URL
2. 用户在浏览器中完成 ChatGPT 登录
3. OpenAI 重定向到 `http://localhost:<CALLBACK_PORT><CALLBACK_PATH>`；服务端校验 `state` 后，用授权码向 `TOKEN_URL` 换取 token
4. 服务端从 `id_token`（回退 `access_token`）解析 `chatgpt_account_id` 与 email，单锁写入账号记录与 auth.json，并设为激活

设备码（无头）：

1. 服务端向 `DEVICE_REQUEST_URL` 申请设备码，拿到 `user_code`、`interval` 与过期时间，返回验证地址 `DEVICE_VERIFICATION_URL`
2. 页面展示设备码；用户在浏览器打开验证地址并输入设备码
3. Web 轮询登录状态；服务端按 `interval` 向上游 `DEVICE_TOKEN_URL` 查询，未批准（403/404）时保持 pending，不在后台空转
4. 批准后上游返回 `authorization_code` 与 `code_verifier`，服务端用 `DEVICE_REDIRECT_URI` 在 `TOKEN_URL` 完成交换，后续身份提取与写入流程同上

关闭添加弹窗会取消未完成的登录；浏览器模式会立即释放回调端口。登录会话超时分别由 `PENDING_TTL_MS`（浏览器）与 `DEVICE_DEFAULT_TTL_MS`（设备码，优先使用上游 `expires_at`）控制。

两种方式共用同一套授权参数与凭证模型；scope、`id_token_add_organizations`、`codex_cli_simplified_flow`、`originator` 定义在 `openai.ts` 的常量中。

## 添加 / 切换 / 删除

| 操作 | 行为 |
|------|------|
| **添加** | OAuth 回调成功后写入账号记录与 auth.json 条目；同一 `accountId` 重复登录即更新（保留原账号 id） |
| **切换** | 先把当前激活账号在 auth.json 中的最新 token 回写到其记录（opencode 可能已轮换刷新令牌），再检查目标 token 是否临近过期并刷新，最后重写 auth.json 条目 |
| **删除活跃账号** | 同步删除 auth.json 的 `openai` 条目，清除 `activeIds.openai`，避免 runtime 继续使用已删除账号的凭证 |
| **删除非活跃账号** | 仅移除账号记录，不改动凭证与运行实例 |

添加、切换、删除活跃账号后都会对运行中的 account-store runtime 调用 `POST /instance/dispose`，让 opencode 重新解析凭证。

## 用量

ChatGPT 没有公开的用量查询端点，因此该 provider 不声明 `UsageSource`：

- 账号卡片显示「用量暂不可用」，不请求远端、不伪造窗口数据
- 账号列表、切换、删除不受影响

## 运行时感知

- opencode 在实例创建时解析 auth.json 并缓存 SDK/语言模型；`openai` 条目写入后，`/provider` 会把对应模型标记为已配置
- 凭证变更（添加 / 切换 / 删除活跃账号）后，服务端经 `lib/credential-refresh.ts` 重建 account-store 实例状态，新凭证无需重启进程即用于后续会话
- 代价：重建发生在响应返回后，若当时有进行中的回合，该回合可能被中断（会话记录保留）

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/usage/oauth/authorize` | body `{"provider":"openai","method":"callback"\|"device"}`；`method` 省略时为浏览器授权。设备码响应额外包含 `userCode` 与 `intervalMs` |
| GET | `/api/usage/oauth/openai/logins/:pendingId` | 轮询登录状态：`{state:"pending"}` 或 `{state:"complete",result}`；设备码追加 `?method=device` |
| DELETE | `/api/usage/oauth/openai/logins/:pendingId` | 取消未完成登录；设备码追加 `?method=device`，浏览器模式同时释放回调端口 |
| GET | `/api/usage?provider=openai` | 账号列表（无用量字段） |
| POST | `/api/usage/switch` | 切换（body 携带 `provider:"openai"`） |
| DELETE | `/api/usage/accounts/:id` | 删除账号 |

## 边界

- **浏览器授权**：浏览器需要能访问 fourth-spark 所在机器的 `localhost:<CALLBACK_PORT>`，适用于同机安装；远程/容器部署请使用设备码登录
- **设备码**：不依赖本机回调端口，适合远程、容器与无桌面环境；需要用户手动输入一次短码
- **端口占用**：仅浏览器授权受影响；回调端口被占用时发起登录返回 409 并给出端口信息，关闭弹窗或完成登录后端口释放
- **账号池模式**：OpenAI 是机器本地凭证，worker/账号池模式下仍可配置，界面标注「仅本地」；只有默认 provider（Claude）的账号来源由账号池接管
- **既有手动凭证**：此前通过 `opencode auth login` 写入的 `openai` 条目不会自动出现在账号列表；在本页用同一 ChatGPT 账号重新登录一次即可纳入管理（同一 `accountId` 更新原记录）
- **凭证存储**：依赖 opencode v1 的 auth.json；v2（SQLite 凭证库）适配在后续工作项中跟进

# OpenAI (ChatGPT) 账号

通过 ChatGPT 账号的浏览器 OAuth 登录，把凭证写入本机 opencode 的 `auth.json`，供 opencode runtime 的 `openai` provider（Codex/ChatGPT 模型）使用。实现见 `packages/server/src/lib/account-providers/openai.ts`。

## 凭据模型

- **auth.json 条目**（opencode runtime 直读）：`{"openai": {"type": "oauth", "access": "…", "refresh": "…", "expires": 0, "accountId": "…"}}`
  - `expires` 为毫秒时间戳
  - `accountId` 来自 token 的 JWT claims，opencode 用它设置 `ChatGPT-Account-Id` 请求头；缺少该字段时登录失败，不会生成伪造 id
- **账号记录**（`claude-accounts.json`）：`provider: "openai"`、`accountId` 与刷新令牌一起持久化；`activeIds.openai` 指向当前激活账号
- 账号 id 即 ChatGPT `accountId`；显示标签优先取 token 中的 email，缺失时回退为 `ChatGPT · <accountId 后 6 位>`
- 适配器与端点定义见 `openai.ts`、`auth-json.ts`

## 登录流程

1. 设置 → 账号 → 「添加 ChatGPT 账号」启动登录；服务端生成 PKCE verifier/challenge 与 `state`，在回环地址上监听固定回调端口（`CALLBACK_PORT`），返回授权 URL
2. Web 端打开授权页；用户在浏览器中完成 ChatGPT 登录
3. OpenAI 重定向到 `http://localhost:<CALLBACK_PORT><CALLBACK_PATH>`；服务端校验 `state` 后，用授权码向 `TOKEN_URL` 换取 `access_token`/`refresh_token`/`id_token`
4. 服务端从 `id_token`（回退 `access_token`）解析 `chatgpt_account_id` 与 email，单锁写入账号记录与 auth.json，并设为激活
5. 关闭添加弹窗会取消未完成的登录并释放回调端口；登录会话超时时间为 `PENDING_TTL_MS`

授权请求参数（scope、`id_token_add_organizations`、`codex_cli_simplified_flow`、`originator`）与 OpenAI 官方 Codex 客户端保持一致，定义在 `openai.ts` 的常量中。

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
| POST | `/api/usage/oauth/authorize` | body `{"provider":"openai"}`；返回 `{mode:"oauth-callback",url,pendingId,expiresAt}` |
| GET | `/api/usage/oauth/openai/logins/:pendingId` | 轮询登录状态：`{state:"pending"}` 或 `{state:"complete",result}` |
| DELETE | `/api/usage/oauth/openai/logins/:pendingId` | 取消未完成登录并释放回调端口 |
| GET | `/api/usage?provider=openai` | 账号列表（无用量字段） |
| POST | `/api/usage/switch` | 切换（body 携带 `provider:"openai"`） |
| DELETE | `/api/usage/accounts/:id` | 删除账号 |

## 边界

- **本机回调**：浏览器需要能访问 fourth-spark 所在机器的 `localhost:<CALLBACK_PORT>`。同机安装可直接使用；容器或远程部署暂不适用此流程（回调无法到达容器内的回环端口），可改用 `opencode auth login` 写入凭证
- **端口占用**：回调端口被其他程序占用时，发起登录返回 409 并给出端口信息；关闭弹窗或完成登录后端口释放
- **账号池模式**：OpenAI 是机器本地凭证，worker/账号池模式下仍可配置，界面标注「仅本地」；只有默认 provider（Claude）的账号来源由账号池接管
- **既有手动凭证**：此前通过 `opencode auth login` 写入的 `openai` 条目不会自动出现在账号列表；在本页用同一 ChatGPT 账号重新登录一次即可纳入管理（同一 `accountId` 更新原记录）
- **凭证存储**：依赖 opencode v1 的 auth.json；v2（SQLite 凭证库）适配在后续工作项中跟进

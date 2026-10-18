# OpenCode Go 账号

OpenCode Go 订阅账号接入——粘贴 Console 签发的 API Key（`oc_sk_…`）即可在第四方应用内使用开源编码模型。

## 凭据模型

- **auth.json 条目**（opencode runtime 直读）：`{"opencode-go": {"type": "api", "key": "oc_sk_…"}}`
- **账号记录**（`claude-accounts.json`）：key 作为持久凭证存储；`activeIds["opencode-go"]` 指向当前激活账号
- 适配器与端点定义见 `packages/server/src/lib/account-providers/opencode-go.ts`、`auth-json.ts`

## 添加 / 切换 / 删除

| 操作 | 行为 |
|------|------|
| **添加** | 粘贴 API Key → 经 models 端点校验（401 视为无效）→ 单锁写入账号记录与 auth.json 条目并设为激活 |
| **切换** | 重写 auth.json 条目为目标的 key（与 Claude 切号同机制）；静态密钥不参与轮换，切换不回写来源账号 |
| **删除** | 删除活跃账号时同步清除 auth.json 条目（避免 runtime 继续使用已删除账号的密钥）；非活跃账号仅移除记录 |

账号 id 为 key 的 SHA-256 前 16 位（同一 key 重复添加即去重更新）；显示标签取 key 末四位。

## 用量

- 采集 opencode.ai 的 zen usage 端点，映射为三个窗口：**5 小时**（rolling）/ **每周**（weekly）/ **每月**（monthly），展示已用百分比与重置时间
- **best-effort 降级**：用量获取失败（网络、HTTP 错误、响应结构不可解析）时账号卡片静默显示「用量暂不可用」，不影响切换/删除，不产生错误弹窗
- 添加/删除账号后服务端立即失效该 provider 的用量缓存，页面刷新即反映最新账号集合

## 运行时感知

- 写入 auth.json 条目后，opencode runtime 的 `/provider` 将 `opencode-go` 标记为 connected，模型 Tab 对应模型显示为已配置（`configured` 机制）
- **运行期新增实时生效**；删除「runtime 启动时已连接」的 provider 需 runtime 重启后才从 connected 列表消失（opencode 启动时缓存连接态所致，磁盘状态始终正确）

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/usage?provider=opencode-go` | 账号列表 + 用量 |
| POST | `/api/usage/switch` | 切换（body 携带 `provider`） |
| POST | `/api/usage/accounts` | 添加 API Key 账号（校验失败返回 `invalid-key`/`unreachable` 等 reason） |
| DELETE | `/api/usage/accounts/:id` | 删除账号 |

## 边界

- 账号池（worker）模式只影响 Claude 账号来源；OpenCode Go 为机器本地凭证，在账号池模式下同样可配置（界面标注「仅本地」）
- 一个 workspace 只允许一个 Go 订阅成员，多账号 = 多 workspace 的 key
- 依赖 opencode v1 的 auth.json 凭证存储；v2（SQLite 凭证库）适配在后续工作项中跟进

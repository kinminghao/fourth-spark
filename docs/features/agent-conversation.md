# Agent 对话

与 AI Agent 的实时对话界面，支持流式渲染、工具可视化、进度追踪和交互式问答。

## SSE 流式渲染

- 基于 Server-Sent Events 实时推送消息，文本逐步呈现
- 每个 Session 独立 SSE 连接（`/api/repos/:repoId/sessions/:id/events`）
- 全局事件流（`/api/repos/:repoId/events`）用于跨 Session 状态同步
- 连接中断自动重连，浏览器切后台时暂停轮询、切回前台恢复
- 心跳间隔 30 秒，服务端 `idleTimeout: 0` 防止长连接被断开
- `SessionOrchestrator` 统一管理：为每个活跃 Session 维护独立的 `SessionWorker`，由 `GlobalEventDispatcher` 分发事件，`SessionSupervisor` 定期检查连接健康

## 消息部件渲染

每条 Assistant 消息拆分为多个 Part，按类型分别渲染：

| Part 类型 | 渲染方式 |
|-----------|---------|
| `text` | Markdown 渲染（react-markdown + remark-gfm + rehype-highlight + rehype-raw） |
| `thinking` | 折叠面板，点击展开查看 Claude 思考过程 |
| `tool-invocation` | 工具调用卡片，显示工具名、输入参数、输出结果、运行状态 |
| `step-finish` | 步骤完成标记（不可见，用于截断检测） |

## 工具调用可视化

每种工具以独立卡片展示，包含状态指示（pending → running → completed / error）：

- **Read** — 显示文件路径和读取范围（offset / limit）
- **Write** — 显示目标文件路径和写入内容摘要
- **Edit** — 显示文件路径、oldString → newString 差异
- **Bash** — 显示命令、工作目录、输出结果（可折叠）
- **Grep / Glob** — 显示搜索模式和匹配结果列表
- **Fetch / WebSearch** — 显示 URL 和获取结果
- **Task** — 显示子 Agent 任务描述和状态，支持跳转到子 Session
- **Todowrite** — 显示 Todo 列表变更
- **Question** — 交互式问答面板（见下节）

工具卡片默认折叠输出，点击展开完整内容；输出超长时自动截断。

## 交互式 Question

当 Agent 需要用户输入时：

- 渲染为选择题面板，显示问题描述和选项列表
- 用户点击选项后通过 `POST /sessions/:id/questions/reply` 提交答案
- 支持拒绝回答（`POST /sessions/:id/questions/reject`）
- 有未回答问题时，全局 Toast 持续提醒直到回答

## Todo 进度追踪

- Session 级别的 Todo 列表，Agent 通过 `todowrite` 工具创建和更新
- 四种状态：`pending` / `in_progress` / `completed` / `cancelled`
- 优先级：`high` / `medium` / `low`
- 消息区域顶部显示紧凑进度条（已完成 / 总数）
- 右侧边栏展示完整 Todo 列表及每项详情
- 通过 SSE 实时推送 Todo 变更

## Token / Cost 实时统计

Session 维度统计并实时展示：

- **Input tokens** — 输入 token 数
- **Output tokens** — 输出 token 数
- **Reasoning tokens** — 推理 token 数
- **Cache read / write** — 缓存命中和写入 token 数
- **Cost** — 累计花费金额（美元）
- 每条消息独立计费，数据存入 `messages` 表的 `cost` 字段
- Session 级汇总存入 `sessions` 表的 `cost` / `tokens_*` 字段

## 消息草稿自动保存

- 输入框内容按 Session ID 自动保存到 Zustand store（`draft-store`）
- 切换 Session 时自动恢复上次未发送的草稿
- 发送消息后自动清除草稿

## 模型选择

- 每次发送消息时可选择不同模型
- `ModelCombobox` 下拉组件，优先展示在设置页钉选的常用模型
- 支持搜索过滤全部可用模型
- 模型列表从 OpenCode 进程实时获取（`GET /api/repos/:repoId/models`）
- 排除非文本模型（whisper、TTS、DALL-E 等）

## 会话操作

- **新建 Session** — 可指定 Custom Agent、模型、关联 Issue
- **重命名** — 修改 Session 标题
- **删除** — 删除 Session 及其全部消息
- **中止** — 停止正在运行的 Agent（`POST /sessions/:id/abort`）
- **Session 列表** — 按创建时间排序，显示标题、Agent 名、状态指示、Token 统计摘要

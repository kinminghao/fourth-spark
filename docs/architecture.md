# 架构详解

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│  React 19 + Vite + Zustand                              │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │ ReposPage│ │ RunPage  │ │IssuesPage│ │SettingsPage│ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘ │
│        │           │             │             │        │
│        └───────────┴──────┬──────┴─────────────┘        │
│                    SSE + REST                           │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────┐
│  Server (Bun + Hono :3000 / HTTPS :3443)                   │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Routes (22 模块)                                    │   │
│  │  repos · sessions · events · agents · issues · pulls │   │
│  │  tags · milestones · models · settings · health      │   │
│  │  workspaces · transcribe · cloud · agent-memories .. │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                  │
│  ┌──────────────────────┴──────────────────────────────┐   │
│  │  Core Abstraction Layer (core/)                      │   │
│  │                                                      │   │
│  │  RuntimeManager ─── 注册 Provider、路由 repo 生命周期  │   │
│  │  RuntimeClient ──── 统一的会话操作接口 (routes 依赖)   │   │
│  │  RuntimeProvider ── 运行时插件接口 (初始化/销毁/健康)  │   │
│  │  PluginRegistry ─── 通知/MCP/Git平台/账号池 注册中心  │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                  │
│  ┌──────────────────────┴──────────────────────────────┐   │
│  │  Service Modules (lib/)                              │   │
│  │                                                      │   │
│  │  SessionMonitor ─── 状态轮询、自动恢复、截断续写       │   │
│  │  SyncScheduler ──── 每小时全量同步 Issue/PR/Comment   │   │
│  │  AccountSwitcher ── Claude 多账号轮换、Token 刷新      │   │
│  │  SenseVoice ─────── 本地语音转文字 (离线 STT)         │   │
│  │  TLS Manager ────── 自签证书、LAN HTTPS               │   │
│  │  MemoryExtractor ── Agent 记忆提取与管理               │   │
│  │  GitProvider ────── GitHub/Gitea/GitLab 统一抽象       │   │
│  │  MCP Server ─────── 给 Agent 暴露 Git 平台工具 (13个) │   │
│  │  APNs / Notify ──── iOS 推送 + macOS 桌面通知          │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                  │
│  ┌──────────────────────┴──────────────────────────────┐   │
│  │  Drizzle ORM → PostgreSQL (Docker :5432)             │   │
│  │  21 tables: repos, sessions, messages, parts, todos, │   │
│  │  issues, pulls, tags, milestones, agentMemories ...  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Agent 运行时 (runtimes/)                             │   │
│  │                                                      │   │
│  │  OpenCodeProvider (:8081–8199, HTTP)                  │   │
│  │    Repo A → opencode serve :8081 (cwd /path/a)       │   │
│  │    Repo B → opencode serve :8082 (cwd /path/b)       │   │
│  │                                                      │   │
│  │  ClaudeCodeProvider (stdio, 按需 spawn)               │   │
│  │    Session X → claude -p --session-id X (cwd /path/c)│   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

## 核心数据流

### 用户发送消息

```
Browser InputBar
  → POST /api/repos/:repoId/sessions/:id/prompt
    → Server route (sessions.ts)
      → RuntimeManager.requireClient(repoId)
        → RuntimeClient.prompt(sessionId, content)
          ├── OpenCode: HTTP POST → opencode serve 子进程
          └── Claude Code: spawn `claude -p` → stdin 写入 prompt
          → SSE 事件流返回
            → GlobalEventDispatcher 分发
              → SessionWorker 更新 Store
                → React 渲染
```

### 会话状态监控

```
SessionMonitor (每 3 秒轮询)
  → RuntimeClient.getSessionStatus()
    ├── idle → 检测截断 → 自动续写
    ├── busy → 状态转换通知
    └── retry → 检测限额错误
                 → AccountSwitcher.autoSwitch()
                   → 刷新 Token → 切换账号 → 重新提交
```

### MCP Git 工具调用

```
Agent 工具调用 (运行时内部)
  → MCP request → http://127.0.0.1:3000/api/repos/:repoId/mcp
    → git-tools.ts 解析工具名 (13 个工具)
      → GitProvider → GitHub/Gitea/GitLab API
        → 结果写入 PostgreSQL + 返回 Agent
```

### 后台数据同步

```
SyncScheduler (每小时)
  → 遍历所有 repos
    → GitProvider.listIssues/listPullRequests/listMilestones (全量)
      → 并发同步 comments/tags/pr-issue-links
        → 写入 PostgreSQL (upsert)
```

## 项目结构

```
fourth-spark/
├── packages/
│   ├── server/                  # 后端 API
│   │   ├── src/
│   │   │   ├── index.ts         # Hono 应用入口、路由挂载、静态文件、启动序列
│   │   │   ├── cli.ts           # CLI 入口 (start/stop/status/upgrade/serve)
│   │   │   ├── cli/
│   │   │   │   ├── start.ts     # 后台启动 (拉起 PostgreSQL + fork server)
│   │   │   │   ├── stop.ts      # 停止所有服务
│   │   │   │   ├── status.ts    # 检查运行状态
│   │   │   │   ├── upgrade.ts   # 自动更新二进制
│   │   │   │   └── paths.ts     # 运行时路径 (PID file, log dir)
│   │   │   ├── core/                    # 运行时抽象层
│   │   │   │   ├── runtime-manager.ts   # 顶层编排器，路由 repo 到 provider
│   │   │   │   ├── runtime-client.ts    # 统一会话操作接口 (routes 依赖)
│   │   │   │   ├── runtime-provider.ts  # 运行时插件接口 (初始化/销毁/健康)
│   │   │   │   ├── runtime-types.ts     # 共享数据类型 (Session/Message/Todo/...)
│   │   │   │   ├── registry.ts          # 插件注册中心 (通知/MCP/Git/账号池)
│   │   │   │   └── types.ts             # 插件接口定义 (4 Phase)
│   │   │   ├── runtimes/                # 运行时实现
│   │   │   │   ├── opencode/            # OpenCode 运行时 (HTTP, 一个进程/repo)
│   │   │   │   │   ├── provider.ts      # 进程生命周期、端口分配、孤儿收养
│   │   │   │   │   ├── client.ts        # HTTP REST API 客户端
│   │   │   │   │   ├── credential.ts    # 认证文件读写
│   │   │   │   │   └── mcp.ts           # opencode.json MCP 注入
│   │   │   │   └── claude-code/         # Claude Code 运行时 (stdio, 一个子进程/session)
│   │   │   │       ├── provider.ts      # .mcp.json 注入、binary 检测
│   │   │   │       ├── client.ts        # StdioRuntimeClient (spawn claude -p)
│   │   │   │       ├── event-adapter.ts # NDJSON → SSE 事件转换
│   │   │   │       ├── credential.ts    # Claude 认证文件读写
│   │   │   │       └── mcp.ts           # .mcp.json MCP 注入
│   │   │   ├── db/
│   │   │   │   ├── schema.ts    # Drizzle 表定义 (21 表)
│   │   │   │   ├── index.ts     # 数据库连接
│   │   │   │   ├── query.ts     # 通用查询辅助
│   │   │   │   ├── sync.ts      # Runtime → PostgreSQL 数据同步
│   │   │   │   └── migrate.ts   # 生产环境 migration 执行
│   │   │   ├── lib/                             # 服务模块 (28 个)
│   │   │   │   ├── process-manager.ts           # 薄包装：注册 Provider → 导出 runtimeManager
│   │   │   │   ├── session-monitor.ts           # 会话状态监控与自动恢复
│   │   │   │   ├── sync-scheduler.ts            # 每小时全量同步 Issue/PR/Comment/Tag
│   │   │   │   ├── account-switcher.ts          # Claude 多账号切换
│   │   │   │   ├── auth-files.ts                # Claude 认证文件读写
│   │   │   │   ├── token-refresh.ts             # OAuth Token 刷新
│   │   │   │   ├── claude-usage.ts              # 订阅用量采集
│   │   │   │   ├── usage-client.ts              # 用量 API 客户端
│   │   │   │   ├── local-account-pool.ts        # 本地多账号池
│   │   │   │   ├── lease-client.ts              # Cloud 账号池客户端
│   │   │   │   ├── lease-keeper.ts              # Lease 续约守护
│   │   │   │   ├── lease-writer.ts              # Lease 凭证写入
│   │   │   │   ├── lease-strategy.ts            # Lease 选择策略
│   │   │   │   ├── lease-constants.ts           # Lease 常量
│   │   │   │   ├── sensevoice-manager.ts        # SenseVoice 语音转文字模型管理
│   │   │   │   ├── tls-manager.ts               # 自签 TLS 证书、LAN HTTPS
│   │   │   │   ├── memory-extractor.ts          # Agent 记忆提取与执行
│   │   │   │   ├── agent-validator.ts           # Agent 名称校验缓存
│   │   │   │   ├── workspace-manager.ts         # Git Worktree 管理
│   │   │   │   ├── git-provider.ts              # GitHub/Gitea/GitLab 统一抽象
│   │   │   │   ├── git-url.ts                   # Git URL 解析 (host/owner/repo)
│   │   │   │   ├── git-runner.ts                # Git 命令执行器
│   │   │   │   ├── system-agents.ts             # 内置 Agent 初始化
│   │   │   │   ├── opencode.ts                  # OpenCode REST API 辅助
│   │   │   │   ├── apns.ts                      # Apple Push Notification
│   │   │   │   ├── notify.ts                    # macOS 桌面通知
│   │   │   │   ├── lockfile.ts                  # 进程锁文件
│   │   │   │   └── config.ts                    # 环境变量、端口、版本、Worker 配置
│   │   │   ├── mcp/
│   │   │   │   └── git-tools.ts         # MCP Server: 13 个 Git 平台工具
│   │   │   ├── routes/                  # Hono 路由 (22 模块)
│   │   │   │   ├── repos.ts             # 仓库 CRUD + 进程控制
│   │   │   │   ├── sessions.ts          # 会话管理 + prompt
│   │   │   │   ├── events.ts            # SSE 事件流代理
│   │   │   │   ├── agents.ts            # 运行时内置 Agent 列表
│   │   │   │   ├── custom-agents.ts     # 自定义 Agent CRUD (全局 + 仓库级)
│   │   │   │   ├── prompt-fragments.ts  # Prompt 片段 CRUD (全局 + 仓库级)
│   │   │   │   ├── agent-memories.ts    # Agent 记忆 CRUD + 提取
│   │   │   │   ├── issues.ts            # Issue 同步 + CRUD
│   │   │   │   ├── pulls.ts             # PR 同步 + 合并
│   │   │   │   ├── tags.ts              # 自定义标签管理
│   │   │   │   ├── milestones.ts        # 里程碑同步
│   │   │   │   ├── models.ts            # LLM 模型列表
│   │   │   │   ├── agents-md.ts         # AGENTS.md 读写 (全局 + 仓库级)
│   │   │   │   ├── settings.ts          # 全局设置 KV
│   │   │   │   ├── git-hosts.ts         # Git 平台凭证管理
│   │   │   │   ├── usage.ts             # Token 用量统计 + 账号切换
│   │   │   │   ├── cloud.ts             # Cloud 账号池管理
│   │   │   │   ├── transcribe.ts        # 语音转文字 (SenseVoice)
│   │   │   │   ├── workspaces.ts        # Workspace 管理
│   │   │   │   ├── push.ts              # 设备 Token 注册
│   │   │   │   ├── health.ts            # 健康检查
│   │   │   │   └── mcp.ts              # MCP 协议路由
│   │   │   └── middleware/
│   │   │       ├── cors.ts
│   │   │       ├── logger.ts
│   │   │       └── errors.ts
│   │   └── drizzle/                     # SQL migration 文件
│   │
│   └── web/                             # 前端 SPA
│       └── src/
│           ├── App.tsx                  # 路由定义、全局初始化
│           ├── main.tsx                 # React 入口
│           ├── pages/
│           │   ├── ReposPage.tsx         # 仓库列表 + 注册
│           │   ├── RunPage.tsx           # Agent 对话主界面
│           │   ├── IssuesPage.tsx        # Issue 管理
│           │   ├── PullRequestsPage.tsx  # PR 管理
│           │   └── SettingsPage.tsx      # 设置 (Git Host、AGENTS.md、账号)
│           ├── components/              # 16 个 UI 组件
│           │   ├── Layout.tsx           # 全局布局 + 侧边栏导航
│           │   ├── RunView.tsx          # 消息列表渲染
│           │   ├── InputBar.tsx         # 消息输入框
│           │   ├── VoiceButton.tsx      # 语音输入按钮 (SenseVoice)
│           │   ├── Attachments.tsx      # 文件附件选择
│           │   ├── SidePanel.tsx        # 会话列表侧边栏
│           │   ├── ToolCallPanel.tsx    # 工具调用展开面板
│           │   ├── TodoProgress.tsx     # Todo 进度条
│           │   ├── ExecutionBlock.tsx   # 执行块渲染
│           │   ├── ModelCombobox.tsx    # 模型选择下拉
│           │   ├── QuestionPanel.tsx    # Agent 提问交互
│           │   ├── MarkdownTable.tsx    # Markdown 表格渲染
│           │   ├── SwipeDrawer.tsx      # 移动端侧滑抽屉
│           │   └── ...
│           ├── stores/                  # Zustand 状态管理 (10 个)
│           │   ├── repo-store.ts        # 仓库列表 + 活跃仓库
│           │   ├── session-store.ts     # 会话、消息、状态
│           │   ├── agent-store.ts       # 内置 Agent 列表
│           │   ├── custom-agent-store.ts # 自定义 Agent
│           │   ├── issue-store.ts       # Issue 数据
│           │   ├── pr-store.ts          # PR 数据
│           │   ├── draft-store.ts       # 消息草稿自动保存
│           │   ├── layout-store.ts      # 布局状态
│           │   ├── theme-store.ts       # 主题 (dark/light)
│           │   └── toast-store.ts       # Toast 通知
│           ├── lib/                     # 核心逻辑
│           │   ├── api-client.ts        # 后端 API 封装
│           │   ├── session-orchestrator.ts # Worker 池编排
│           │   ├── session-worker.ts    # 单会话事件处理
│           │   ├── session-supervisor.ts # 会话健康检查
│           │   ├── global-event-dispatcher.ts # SSE 事件分发
│           │   ├── sse-events.ts        # SSE 消息解析
│           │   ├── message-parts.ts     # 消息内容类型处理
│           │   ├── push-notifications.ts # Capacitor 推送
│           │   └── config.ts            # API 地址配置
│           └── hooks/
│
├── npm/                                 # npm 发布包模板
│   ├── package.json                     # npm 包配置
│   ├── cli.js                           # bin wrapper → 调用编译二进制
│   ├── postinstall.js                   # 按平台下载 GitHub Release 二进制
│   └── README.md                        # npm 页面展示的精简 README
│
├── scripts/
│   ├── build.sh                         # 跨平台构建 + npm 包组装
│   ├── start.sh                         # 生产环境启动脚本
│   └── stop.sh                          # 生产环境停止脚本
│
├── .github/workflows/
│   └── release.yml                      # CI: 5 平台构建 → GitHub Release → npm publish
│
├── docker-compose.yml                   # PostgreSQL 容器
├── Makefile                             # 开发命令集
├── AGENTS.md                            # Agent 上下文指令
└── README.md
```

## 核心模块职责

### RuntimeManager (`core/runtime-manager.ts`)

顶层编排器，管理所有已注册的 RuntimeProvider 并路由 repo 生命周期调用：

- **Provider 注册** — `registerProvider()` 注册 OpenCode、Claude Code 等运行时
- **Repo 启动** — 按 `repos.runtimeType` 选择 Provider，调用 `initialize()`，返回 RuntimeClient
- **Cloud Lease 池** — 管理 LeaseKeeper 生命周期，cloud/local 模式切换
- **统一接口** — `getClient(repoId)` / `requireClient(repoId)` 让 routes 不关心底层运行时

### RuntimeClient (`core/runtime-client.ts`)

routes 依赖的统一会话操作接口，每个 repo 一个实例：

- Session CRUD、消息获取、prompt、abort、Todo、事件流
- 交互式 Question 应答、Agent 列表、Provider/Model 查询、revert
- 两种实现：`HttpRuntimeClient`（OpenCode）和 `StdioRuntimeClient`（Claude Code）

### OpenCodeProvider (`runtimes/opencode/provider.ts`)

管理 OpenCode 子进程（一个长驻 `opencode serve` 进程/repo）：

- **端口分配** — 8081–8199 范围内自动分配空闲端口
- **进程启动** — `Bun.spawn` 启动 `opencode serve`，等待就绪后注册
- **孤儿收养** — 启动时检查 PID 文件 (`pid-map.opencode.json`)，验证并收养存活的旧进程
- **MCP 注入** — 向仓库的 `opencode.json` 写入 MCP server 配置，停止时清理
- **初始同步** — 进程就绪后同步所有会话和消息到 PostgreSQL
- **并发安全** — 同一 repo 的 start() 调用通过 Promise 锁去重

### ClaudeCodeProvider (`runtimes/claude-code/provider.ts`)

管理 Claude Code CLI 子进程（一个 `claude -p` 子进程/session，按需 spawn）：

- **Stdio 通信** — 每个 session 按需 spawn `claude -p --output-format stream-json`
- **NDJSON → SSE** — `event-adapter.ts` 将 Claude Code 的 NDJSON 输出转为 OpenCode 兼容的 SSE
- **进程管理** — 新 prompt 杀旧进程，后续 turn 使用 `--resume` 恢复
- **MCP 注入** — 向仓库的 `.mcp.json` 写入配置

### SessionMonitor (`lib/session-monitor.ts`)

每 3 秒轮询所有活跃会话状态：

- **状态转换通知** — idle/busy/retry 之间的转换触发桌面和推送通知
- **截断自动续写** — 检测 assistant 消息缺少 `step-finish` 且有未完成 Todo → 自动发送 continue
- **空响应重试** — 检测 assistant 回复无可见内容 → 自动重试
- **限额错误处理** — 检测 rate limit 类错误 → 触发 AccountSwitcher
- **防抖与限流** — 去重冷却、最大续写次数、停滞检测、空闲响应检测

### SyncScheduler (`lib/sync-scheduler.ts`)

每小时自动从 Git 平台全量同步数据：

- **全量同步** — Issue、PR、Milestone、Comment、Tag 全部 upsert
- **并发控制** — 最多 3 个 repo 并发同步，每个 repo 内 5 并发拉取评论/PR 详情
- **PR-Issue 关联** — 解析 PR body 中的 `Closes #N` / `Fixes #N` 自动创建 prIssueLinks

### AccountSwitcher (`lib/account-switcher.ts`)

Claude 订阅账号的自动轮换：

- **Token 刷新** — 通过 OAuth refresh_token 自动续期 access_token
- **冷却机制** — 触发限额的账号进入冷却期，避免反复切换
- **轮换策略** — 按注册顺序环形选择下一个可用账号
- **文件同步** — 切换后同步更新 Claude 认证文件

### SenseVoice (`lib/sensevoice-manager.ts`)

本地离线语音转文字：

- **模型管理** — 首次启动自动下载 SenseVoice 二进制 + GGUF 模型 (~240 MB)
- **跨平台** — 支持 linux-x64、linux-arm64、darwin-arm64
- **转写** — `transcribe(audioPath)` 调用本地二进制，返回文本

### MemoryExtractor (`lib/memory-extractor.ts`)

自定义 Agent 的会话记忆提取与管理：

- **提取** — 从会话历史构建 prompt，提取 add/update/merge/reinforce/skip 操作
- **分类** — general/decision/lesson/preference/pattern 五种记忆分类
- **重要度** — 0–1 浮点评分，reinforce 操作自动提升 20%
- **合并** — 多条旧记忆可合并为一条新记忆，旧记忆标记 supersededBy

### MCP Server (`mcp/git-tools.ts`)

暴露给 Agent 的 Git 平台工具集（13 个工具）：

- 仓库信息查询 (`get_repo_info`)
- Issue CRUD (`list_issues`, `get_issue`, `create_issue`, `update_issue`)
- 评论管理 (`create_comment`, `list_comments`)
- PR 管理 (`list_pull_requests`, `get_pull_request`, `create_pull_request`, `list_pr_comments`, `create_pr_comment`, `merge_pull_request`)
- **自动关联** — 创建 Issue/PR 时自动关联当前 busy session
- **分支重命名** — 创建 PR 时自动将 `ws/` 前缀 workspace 分支重命名为 PR head 分支

凭证从 PostgreSQL `git_hosts` 表按 host 自动匹配，支持 GitHub / Gitea / GitLab。

### 前端事件架构

```
GlobalEventDispatcher
  │  (SSE 连接到 /api/repos/:repoId/events)
  │
  ├── SessionWorker (per session)
  │     处理消息增量更新、状态变化
  │
  └── SessionSupervisor
        定期检查 Worker 健康、按需重建
```

- **SessionOrchestrator** — 管理 Worker 池，按需创建/销毁
- **SessionWorker** — 单会话的事件处理器，维护消息和 Todo 的实时更新
- **GlobalEventDispatcher** — 维护 SSE 长连接，按 sessionId 分发事件
- **SessionSupervisor** — 监控 Worker 健康，页面可见性变化时暂停/恢复

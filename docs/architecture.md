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
│  Server (Bun + Hono :3000)                                 │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Routes (18 模块)                                    │   │
│  │  repos · sessions · events · agents · issues · pulls │   │
│  │  tags · milestones · models · settings · health ...  │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                  │
│  ┌──────────────────────┴──────────────────────────────┐   │
│  │  Core Modules                                        │   │
│  │                                                      │   │
│  │  ProcessManager ─── 子进程生命周期、端口分配、孤儿清理  │   │
│  │  SessionMonitor ─── 状态轮询、自动恢复、截断续写       │   │
│  │  AccountSwitcher ── Claude 多账号轮换、Token 刷新      │   │
│  │  OpenCodeClient ─── OpenCode REST API 封装             │   │
│  │  GitProvider ────── GitHub/Gitea/GitLab 统一抽象       │   │
│  │  MCP Server ─────── 给 Agent 暴露 Git 平台工具         │   │
│  │  APNs / Notify ──── iOS 推送 + macOS 桌面通知          │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                  │
│  ┌──────────────────────┴──────────────────────────────┐   │
│  │  Drizzle ORM → PostgreSQL (Docker :5432)             │   │
│  │  19 tables: repos, sessions, messages, parts,        │   │
│  │  issues, pulls, tags, milestones, settings ...       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  OpenCode 子进程 (:8081–8199)                        │   │
│  │  Repo A → opencode serve :8081 (cwd /path/a)        │   │
│  │  Repo B → opencode serve :8082 (cwd /path/b)        │   │
│  │  Repo C → opencode serve :8083 (cwd /path/c)        │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

## 核心数据流

### 用户发送消息

```
Browser InputBar
  → POST /api/repos/:repoId/sessions/:id/prompt
    → Server route (sessions.ts)
      → OpenCodeClient.prompt(sessionId, content)
        → OpenCode 子进程处理
          → SSE 事件流返回
            → GlobalEventDispatcher 分发
              → SessionWorker 更新 Store
                → React 渲染
```

### 会话状态监控

```
SessionMonitor (每 3 秒轮询)
  → OpenCodeClient.getSessionStatus()
    ├── idle → 检测截断 → 自动续写
    ├── busy → 状态转换通知
    └── retry → 检测限额错误
                 → AccountSwitcher.autoSwitch()
                   → 刷新 Token → 切换账号 → 重新提交
```

### MCP Git 工具调用

```
Agent 工具调用 (opencode 内部)
  → MCP request → http://127.0.0.1:3000/api/repos/:repoId/mcp
    → git-tools.ts 解析工具名
      → GitProvider → GitHub/Gitea/GitLab API
        → 结果写入 PostgreSQL + 返回 Agent
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
│   │   │   ├── db/
│   │   │   │   ├── schema.ts    # Drizzle 表定义 (19 表)
│   │   │   │   ├── index.ts     # 数据库连接
│   │   │   │   ├── query.ts     # 通用查询辅助
│   │   │   │   ├── sync.ts      # OpenCode → PostgreSQL 数据同步
│   │   │   │   └── migrate.ts   # 生产环境 migration 执行
│   │   │   ├── lib/
│   │   │   │   ├── process-manager.ts   # OpenCode 子进程生命周期管理
│   │   │   │   ├── opencode.ts          # OpenCode REST API 客户端
│   │   │   │   ├── session-monitor.ts   # 会话状态监控与自动恢复
│   │   │   │   ├── account-switcher.ts  # Claude 多账号切换
│   │   │   │   ├── auth-files.ts        # Claude 认证文件读写
│   │   │   │   ├── claude-usage.ts      # 订阅用量采集
│   │   │   │   ├── git-provider.ts      # GitHub/Gitea/GitLab 统一抽象
│   │   │   │   ├── git-url.ts           # Git URL 解析 (host/owner/repo)
│   │   │   │   ├── system-agents.ts     # 内置 Agent 初始化
│   │   │   │   ├── apns.ts              # Apple Push Notification
│   │   │   │   ├── notify.ts            # macOS 桌面通知
│   │   │   │   └── config.ts            # 环境变量、端口、版本
│   │   │   ├── mcp/
│   │   │   │   └── git-tools.ts         # MCP Server: 11 个 Git 平台工具
│   │   │   ├── routes/                  # Hono 路由 (18 模块)
│   │   │   │   ├── repos.ts             # 仓库 CRUD + 进程控制
│   │   │   │   ├── sessions.ts          # 会话管理 + prompt
│   │   │   │   ├── events.ts            # SSE 事件流代理
│   │   │   │   ├── agents.ts            # OpenCode 内置 Agent 列表
│   │   │   │   ├── custom-agents.ts     # 自定义 Agent CRUD
│   │   │   │   ├── prompt-fragments.ts  # Prompt 片段 CRUD
│   │   │   │   ├── issues.ts            # Issue 同步 + CRUD
│   │   │   │   ├── pulls.ts             # PR 同步 + 合并
│   │   │   │   ├── tags.ts              # 自定义标签管理
│   │   │   │   ├── milestones.ts        # 里程碑同步
│   │   │   │   ├── models.ts            # LLM 模型列表 + 收藏
│   │   │   │   ├── agents-md.ts         # AGENTS.md 读写
│   │   │   │   ├── settings.ts          # 全局设置 KV
│   │   │   │   ├── git-hosts.ts         # Git 平台凭证管理
│   │   │   │   ├── usage.ts             # Token 用量统计
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
│           ├── components/              # 14 个 UI 组件
│           │   ├── Layout.tsx           # 全局布局 + 侧边栏导航
│           │   ├── RunView.tsx          # 消息列表渲染
│           │   ├── InputBar.tsx         # 消息输入框
│           │   ├── SidePanel.tsx        # 会话列表侧边栏
│           │   ├── ToolCallPanel.tsx    # 工具调用展开面板
│           │   ├── TodoProgress.tsx     # Todo 进度条
│           │   ├── ExecutionBlock.tsx   # 执行块渲染
│           │   ├── ModelCombobox.tsx    # 模型选择下拉
│           │   ├── QuestionPanel.tsx    # Agent 提问交互
│           │   ├── SwipeDrawer.tsx      # 移动端侧滑抽屉
│           │   └── ...
│           ├── stores/                  # Zustand 状态管理 (8 个)
│           │   ├── repo-store.ts        # 仓库列表 + 活跃仓库
│           │   ├── session-store.ts     # 会话、消息、状态
│           │   ├── agent-store.ts       # 内置 Agent 列表
│           │   ├── custom-agent-store.ts # 自定义 Agent
│           │   ├── issue-store.ts       # Issue 数据
│           │   ├── pr-store.ts          # PR 数据
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

### ProcessManager (`lib/process-manager.ts`)

管理 OpenCode 子进程的完整生命周期：

- **端口分配** — 8081–8199 范围内自动分配空闲端口
- **进程启动** — `Bun.spawn` 启动 `opencode serve`，等待就绪后注册
- **孤儿清理** — 启动时检查 PID 文件，验证并收养存活的旧进程，杀死无主进程
- **MCP 注入** — 启动前向仓库的 `opencode.json` 写入 MCP server 配置，停止时清理
- **初始同步** — 进程就绪后同步所有会话和消息到 PostgreSQL
- **并发安全** — 同一 repo 的 start() 调用通过 Promise 锁去重

### SessionMonitor (`lib/session-monitor.ts`)

每 3 秒轮询所有活跃会话状态：

- **状态转换通知** — idle/busy/retry 之间的转换触发桌面和推送通知
- **截断自动续写** — 检测 assistant 消息缺少 `step-finish` 且有未完成 Todo → 自动发送 continue
- **空响应重试** — 检测 assistant 回复无可见内容 → 自动重试
- **限额错误处理** — 检测 rate limit 类错误 → 触发 AccountSwitcher
- **防抖与限流** — 去重冷却、最大续写次数、停滞检测、空闲响应检测

### AccountSwitcher (`lib/account-switcher.ts`)

Claude 订阅账号的自动轮换：

- **Token 刷新** — 通过 OAuth refresh_token 自动续期 access_token
- **冷却机制** — 触发限额的账号进入冷却期，避免反复切换
- **轮换策略** — 按注册顺序环形选择下一个可用账号
- **文件同步** — 切换后同步更新 Claude 认证文件

### MCP Server (`mcp/git-tools.ts`)

暴露给 Agent 的 Git 平台工具集（11 个工具）：

- 仓库信息查询 (`get_repo_info`)
- Issue CRUD (`list_issues`, `get_issue`, `create_issue`, `update_issue`)
- 评论管理 (`create_comment`, `list_comments`)
- PR 管理 (`create_pull_request`, `list_pr_comments`, `create_pr_comment`, `merge_pull_request`)

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

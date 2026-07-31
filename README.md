# Fourth Spark

AI Agent Platform — 基于 OpenCode 的多仓库 Agent 管理平台。

## 架构

```
Frontend (React + Vite :5173)
    │
    ▼
Server (Bun + Hono :3000)
    │
    ├── ProcessManager
    │   ├── Repo A → opencode serve :8081 (cwd /path/a)
    │   ├── Repo B → opencode serve :8082 (cwd /path/b)
    │   └── ...
    │
    ├── SessionMonitor (状态监控 / 错误自动恢复 / 账号切换)
    │
    ├── MCP Server (Git 平台操作代理)
    │
    └── PostgreSQL (Docker :5432)
```

- 每个 repo 对应一个独立的 OpenCode 进程，端口自动分配 (8081-8199, 127.0.0.1)
- 所有 session/event/agent API 挂在 `/api/repos/:repoId/` 下
- Git 平台操作通过内置 MCP server 完成，支持 GitHub / Gitea / GitLab
- Session 监控器轮询会话状态，自动恢复错误、切换账号、发送通知

## 功能特性

### 核心能力

- **多仓库管理** — 注册多个 Git 仓库，每个仓库独立运行 OpenCode 进程，互不干扰；支持启停进程、拉取最新代码
- **Agent 对话** — 浏览器中与 AI Agent 实时对话，SSE 流式渲染消息，工具调用可视化面板，Todo 进度追踪，Token/Cost 实时统计
- **自定义 Agent** — 基于内置 Agent 创建自定义 Agent，可指定 model、system prompt，组合 Prompt 片段，支持导入导出
- **Prompt 片段** — 可复用的 prompt 组件，支持拖拽排序和组合，按需挂载到自定义 Agent

### Git 平台集成

- **多平台支持** — 通过 MCP 统一管理 GitHub / Gitea / GitLab，凭证按 host 自动匹配
- **Issue 管理** — 同步、创建、编辑 Issue，支持状态筛选、标签过滤、里程碑分组、全文搜索
- **Epic/Task 层级** — Issue 支持父子关系树状视图，自动追踪子任务完成进度
- **PR 管理** — 查看关联 PR，合并冲突检测，一键合并
- **评论系统** — Issue 评论的查看、创建和同步
- **Milestone 管理** — 按状态筛选里程碑，关联 Issue 统计
- **自定义 Tag** — 创建自定义标签（名称、颜色、描述），为 Issue 分配标签

### 智能运维

- **Claude 多账号管理** — 追踪多个 Claude 订阅账号的用量配额（5h/7d 窗口），自动检测限额并切换活跃账号
- **Session 监控** — 自动轮询会话状态，错误时自动重试/继续，触发账号切换和推送通知
- **模型管理** — 列出所有可用 LLM 模型，查看上下文窗口和定价，收藏常用模型快速选择

### 数据持久化

- **全量持久化** — 会话、消息、工具调用、Todo 全量存储到 PostgreSQL，进程重启不丢数据
- **用量统计** — 按 session 追踪 cost、input/output/reasoning/cache tokens

### 配置与管理

- **AGENTS.md 管理** — Web 上直接编辑全局和仓库级别的 AGENTS.md
- **Git Host 凭证** — Web UI 管理 GitHub / Gitea / GitLab 的 access token
- **全局设置** — 键值存储系统，持久化平台配置

### 移动端与通知

- **iOS 原生应用** — 基于 Capacitor 构建原生 iOS 应用
- **APNs 推送通知** — Session 完成后推送到移动设备
- **响应式设计** — 支持桌面/平板/手机多端适配，移动端侧滑手势导航

### 部署与运维

- **npm 分发** — `npm install -g fourth-spark` 一键安装，postinstall 自动下载对应平台二进制
- **跨平台构建** — 支持编译为 Linux (x64/arm64)、macOS (x64/arm64)、Windows (x64) 原生二进制
- **CLI 管理** — `fourth-spark start/stop/status/upgrade`，内置进程管理，无需外部脚本
- **自动更新** — `fourth-spark upgrade` 检查最新版本并原子替换二进制，启动时自动提示新版本
- **CI/CD** — GitHub Actions 自动构建、发布 GitHub Release 和 npm，基于 git tag (v*) 触发
- **健康检查** — 后端存活检测、OpenCode 进程可达性检查

## 安装

```bash
npm install -g fourth-spark
```

安装后自动下载对应平台的编译二进制（支持 macOS/Linux/Windows，x64/arm64）。

## 前置依赖

- [Docker](https://docs.docker.com/get-docker/) (用于 PostgreSQL)
- [OpenCode](https://opencode.ai/) CLI (`opencode serve`)

## 快速开始

```bash
# 启动（自动拉起 PostgreSQL + 后台运行 server）
fourth-spark start

# 查看状态
fourth-spark status

# 停止所有服务
fourth-spark stop
```

启动后访问 http://localhost:3000 。

## CLI 命令

```
fourth-spark              前台启动 server（Ctrl-C 停止）
fourth-spark start        后台启动（PostgreSQL + server）
fourth-spark stop         停止所有服务
fourth-spark status       查看运行状态
fourth-spark upgrade      检查并更新到最新版本
fourth-spark --version    查看版本号
fourth-spark --help       查看帮助
```

## 更新

```bash
fourth-spark upgrade
```

或通过 npm：

```bash
npm update -g fourth-spark
```

启动时如有新版本，终端和 Web UI 都会提示。

## 开发者部署

如果需要从源码构建或参与开发：

### 前置依赖

- [Bun](https://bun.sh/) >= 1.1
- [Docker](https://docs.docker.com/get-docker/) (用于 PostgreSQL)
- [OpenCode](https://opencode.ai/) CLI (`opencode serve`)

### 从源码运行

```bash
git clone https://github.com/kinminghao/fourth-spark.git && cd fourth-spark

# 一键初始化（安装依赖 + 启动 DB + 同步 schema）
make setup

# 启动开发服务
make dev
```

开发模式访问 http://localhost:5173 （Vite 代理到后端 :3000）。

## Makefile 命令

| 命令 | 说明 |
|------|------|
| `make setup` | 一键初始化：安装依赖 → 启动 DB → 同步 schema |
| `make dev` | 启动 Server + Web（前台，自动拉起 DB） |
| `make run` | 后台启动所有服务（DB + Server + Web），日志写入 /tmp/fourth-spark/ |
| `make dev-server` | 仅启动后端 API (port 3000) |
| `make dev-web` | 仅启动前端 Vite dev server (port 5173) |
| `make build` | 构建生产版本（跨平台二进制 + 前端静态资源） |
| `make install` | 安装 npm 依赖 |
| `make db` | 启动 PostgreSQL 容器并等待就绪 |
| `make db-stop` | 停止 PostgreSQL 容器 |
| `make db-push` | 将 schema.ts 直接同步到数据库（开发用） |
| `make db-generate` | 对比 schema 生成 SQL migration 文件 |
| `make db-migrate` | 执行 migration 文件 |
| `make db-studio` | 打开 Drizzle Studio（数据库可视化） |
| `make status` | 查看各服务运行状态（PostgreSQL / Server / Web / OpenCode） |
| `make stop` | 停止所有服务 |
| `make stop-opencode` | 仅停止 opencode 进程 |
| `make logs` | 查看 server 和 opencode 日志 |
| `make clean` | 停止服务并清理日志 |

## 技术栈

**Server**: Bun, Hono, Drizzle ORM, PostgreSQL, Zod, Pino, MCP SDK

**Web**: React 19, Vite, Tailwind CSS 4, Zustand, React Router, React Markdown, Lucide React

**Mobile**: Capacitor (iOS), APNs Push Notifications

**Infra**: Docker Compose, GitHub Actions, OpenCode CLI

## 项目结构

```
packages/
├── server/                # 后端 API
│   ├── src/
│   │   ├── db/            # Drizzle schema (16 tables) + 查询
│   │   ├── lib/           # 核心逻辑
│   │   │   ├── process-manager   # OpenCode 子进程生命周期管理
│   │   │   ├── opencode          # OpenCode REST API 客户端
│   │   │   ├── git-provider      # GitHub/Gitea/GitLab 抽象层
│   │   │   ├── session-monitor   # 会话状态监控与自动恢复
│   │   │   ├── account-switcher  # Claude 多账号切换
│   │   │   ├── claude-usage      # 订阅用量采集
│   │   │   ├── apns              # Apple 推送通知
│   │   │   └── notify            # macOS 桌面通知
│   │   ├── routes/        # Hono 路由 (17 模块)
│   │   └── middleware/
│   └── drizzle/           # Migration 文件
├── web/                   # 前端 SPA
│   └── src/
│       ├── components/    # UI 组件
│       ├── pages/         # 4 个页面 (Repos/Run/Issues/Settings)
│       ├── stores/        # Zustand stores (7 个)
│       ├── hooks/
│       └── lib/           # API client, SSE, session orchestrator
├── npm/                   # npm 发布包模板
│   ├── package.json       # npm 包配置
│   ├── cli.js             # bin wrapper
│   └── postinstall.js     # 平台二进制下载器
└── scripts/
    └── build.sh           # 跨平台构建 + npm 包组装
```

## 开发说明

- 修改 server 代码后 `bun --watch` 自动重启
- 修改 web 代码后 Vite HMR 自动刷新
- DB schema 变更后执行 `make db-push`（开发）或 `make db-generate` + `make db-migrate`（生产）
- Server 启动时自动为数据库中所有已注册的 repo 拉起独立的 `opencode serve` 进程

# Fourth Spark

自托管的 AI Agent 平台 — 在浏览器中管理多个 Git 仓库，与 AI Agent 实时对话，让它们直接操作你的代码。

## 它解决什么问题

你有多个代码仓库，想让 AI Agent 并行处理不同项目的任务。Fourth Spark 把每个仓库隔离成独立的 Agent 运行时，每个任务还可以创建 Git Worktree 做到分支级隔离。通过统一的 Web UI 管理所有对话、Issue、PR，并自动处理账号限额切换、会话中断恢复、截断续写等运维琐事。支持本地多账号轮换，也可连接远程账号池实现多机共享。

## 架构

```
Browser (React + Vite)  ·  iOS App (Capacitor)
    │
    ▼
Server (Bun + Hono :3000 / HTTPS :3443)
    │
    ├── RuntimeManager ──── 可插拔多运行时：OpenCode (:8081–8199) + Claude Code (stdio)
    ├── SessionMonitor ──── 状态轮询 / 截断续写 / 空响应重试 / 停滞检测
    ├── WorkspaceManager ── Git Worktree 任务隔离
    ├── SyncScheduler ───── 每小时自动同步 Issue/PR/Milestone/Comment/Tag
    ├── AccountPool ─────── 本地多账号轮换 或 Cloud 账号池 (lease)
    ├── MCP Server ──────── Git 平台操作代理 (GitHub · Gitea · GitLab)
    ├── SenseVoice ──────── 本地语音转文字 (离线 STT)
    ├── TLS Manager ─────── 自签证书，LAN HTTPS 访问
    ├── Notifications ───── macOS 桌面通知 + iOS APNs 推送
    └── PostgreSQL ──────── 21 张表全量持久化
```

每个仓库对应一个独立的 Agent 运行时进程（OpenCode 或 Claude Code），端口/进程自动管理，互不干扰。

## 快速开始

```bash
npm install -g fourth-spark    # 自动下载对应平台二进制

fourth-spark start              # 拉起 PostgreSQL + 后台启动
```

访问 **http://localhost:3000**，注册你的第一个仓库即可开始。

> 前置依赖：[Docker](https://docs.docker.com/get-docker/)（用于 PostgreSQL）、[OpenCode](https://opencode.ai/) CLI 和/或 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI

## 核心能力

**[Agent 对话](docs/features/agent-conversation.md)** — SSE 流式渲染，工具调用可视化，Thinking 折叠展开，交互式 Question 应答，Todo 进度追踪，Token/Cost 实时统计，消息草稿自动保存

**[Workspace 隔离](docs/features/workspace-isolation.md)** — 为每个任务创建独立的 Git Worktree，自动 symlink AGENTS.md，支持状态追踪（active / idle / merged / stale）、磁盘用量监控、批量清理已合并分支

**[多运行时支持](docs/features/repo-management.md)** — 每个仓库可选 OpenCode 或 Claude Code CLI 作为 Agent 运行时，通过可插拔 RuntimeProvider 架构统一管理，运行时可按仓库独立配置

**[多仓库管理](docs/features/repo-management.md)** — 注册多个 Git 仓库，独立运行 Agent 进程，支持启停、代码拉取、分支切换，Worktree 开关按仓库配置

**[Git 平台集成](docs/features/git-integration.md)** — 通过 MCP 统一管理 GitHub / Gitea / GitLab 的 Issue、PR、Milestone、标签；支持 Issue 子任务 / Epic 树、PR-Issue 关联、评论管理；创建 Issue/PR 时自动关联当前 Session

**[自定义 Agent](docs/features/custom-agents.md)** — 基于内置 Agent 创建自定义 Agent，指定模型和 System Prompt，组合可复用的 Prompt 片段并排序拼接，支持 JSON 导入导出在不同实例间共享；内置"评论助手"系统 Agent 用于 Issue 评论润色

**[Session 管理](docs/features/session-management.md)** — 会话可与 Issue / PR 双向关联，侧边栏查看关联历史；支持按 Custom Agent 和模型新建会话，模型可从钉选列表快速选择

**[智能运维](docs/features/smart-ops.md)** — Claude 多账号自动轮换（cooldown 持久化跨重启恢复）、会话中断自动恢复、截断自动续写（带停滞检测）、空响应自动重试、桌面（macOS）和 iOS 推送通知

**[Cloud 账号池](docs/features/cloud-account-pool.md)** — 可选连接 [claude-accounts-pool](https://github.com/nicepkg/claude-accounts-pool) Master 服务器，多台机器共享账号池，自动 lease 续约和 rate limit 上报，在设置页面一键切换本地 / 云端模式

**语音输入** — 集成 SenseVoice 本地语音识别（~240 MB 模型，首次启动自动下载），支持离线语音转文字输入 Agent 对话

**Agent 记忆** — 自定义 Agent 的会话记忆自动提取与管理，支持新增、更新、合并、强化等操作，按分类和重要度排序，跨会话持久化

**后台数据同步** — SyncScheduler 每小时自动从 Git 平台全量同步 Issue、PR、Milestone、Comment、Tag，无需手动触发

**LAN HTTPS 访问** — TLS Manager 自动生成自签证书，局域网内其他设备可通过 HTTPS :3443 安全访问

**[数据持久化](docs/features/data-persistence.md)** — 会话、消息、工具调用、Todo、Issue、PR、Milestone、标签、Custom Agent、Prompt 片段、Workspace、Session 关联、Agent 记忆等全量存入 PostgreSQL（21 张表），进程重启不丢数据

## CLI

```
fourth-spark                    前台启动（Ctrl-C 停止）
fourth-spark start [--port N]   后台启动（含 PostgreSQL，默认端口 3000）
fourth-spark stop               停止所有服务
fourth-spark status             查看运行状态
fourth-spark upgrade            检查并更新到最新版本
```

## 技术栈

| 层 | 技术 |
|----|------|
| Server | Bun, Hono, Drizzle ORM, PostgreSQL, Zod, Pino, MCP SDK |
| Web | React 19, Vite, Tailwind CSS 4, Zustand, React Router |
| Mobile | Capacitor (iOS), APNs |
| Infra | Docker Compose, GitHub Actions, npm 跨平台二进制分发 |

## 从源码开发

```bash
git clone https://github.com/kinminghao/fourth-spark.git && cd fourth-spark
make setup    # 安装依赖 + 启动 DB + 同步 schema
make dev      # 启动 Server (:3000) + Web (:5173)
```

开发模式访问 http://localhost:5173。详见 [开发指南](docs/development.md)。

## 文档

| 文档 | 内容 |
|------|------|
| [架构详解](docs/architecture.md) | 系统架构、项目结构、数据流、核心模块职责 |
| [开发指南](docs/development.md) | 环境搭建、Makefile 命令、Schema 变更、调试 |
| [数据库设计](docs/database.md) | 完整 Schema、表关系、设计说明 |
| [部署运维](docs/deployment.md) | npm 分发、CLI 详解、CI/CD、环境变量、跨平台构建 |

### 功能详解

| 文档 | 内容 |
|------|------|
| [Agent 对话](docs/features/agent-conversation.md) | SSE 流式、工具可视化、Thinking/Question、Todo 追踪、Token 统计 |
| [Workspace 隔离](docs/features/workspace-isolation.md) | Git Worktree 创建/状态/清理、PR 分支重命名、按仓库开关 |
| [多仓库管理](docs/features/repo-management.md) | 注册/启停、进程管理、孤儿回收、分支切换、代码拉取 |
| [Git 平台集成](docs/features/git-integration.md) | MCP 工具、Issue/PR/Milestone 同步、子任务 Epic、评论润色 |
| [自定义 Agent](docs/features/custom-agents.md) | Prompt 片段、Agent 组合与排序、导入导出、系统 Agent |
| [Session 管理](docs/features/session-management.md) | 生命周期、Issue/PR 关联、Workspace 绑定、数据同步 |
| [智能运维](docs/features/smart-ops.md) | 截断续写、空响应重试、账号轮换、通知系统、参数配置 |
| [Cloud 账号池](docs/features/cloud-account-pool.md) | Lease 协议、LeaseKeeper、Rate Limit 上报、模式切换 |
| [数据持久化](docs/features/data-persistence.md) | 19 张表 Schema、同步机制、迁移流程、索引策略 |

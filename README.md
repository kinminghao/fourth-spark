# Fourth Spark

自托管的 AI Agent 平台 — 在浏览器中管理多个 Git 仓库，与 AI Agent 实时对话，让它们直接操作你的代码。

## 它解决什么问题

你有多个代码仓库，想让 AI Agent 并行处理不同项目的任务。Fourth Spark 把每个仓库隔离成独立的 Agent 运行时，通过统一的 Web UI 管理所有对话、Issue、PR，并自动处理账号限额切换、会话中断恢复等运维琐事。

## 架构

```
Browser (React + Vite)
    │
    ▼
Server (Bun + Hono :3000)
    │
    ├── ProcessManager ─── 每个 Repo 一个 OpenCode 进程 (:8081–8199)
    ├── SessionMonitor ─── 状态轮询 / 自动恢复 / 账号切换
    ├── MCP Server ──────── Git 平台操作代理 (GitHub · Gitea · GitLab)
    └── PostgreSQL ──────── 会话、消息、Issue、PR 全量持久化
```

每个仓库对应一个独立的 [OpenCode](https://opencode.ai/) 进程，端口自动分配，互不干扰。

## 快速开始

```bash
npm install -g fourth-spark    # 自动下载对应平台二进制

fourth-spark start              # 拉起 PostgreSQL + 后台启动
```

访问 **http://localhost:3000**，注册你的第一个仓库即可开始。

> 前置依赖：[Docker](https://docs.docker.com/get-docker/)（用于 PostgreSQL）、[OpenCode](https://opencode.ai/) CLI

## 核心能力

**Agent 对话** — SSE 流式渲染，工具调用可视化，Todo 进度追踪，Token/Cost 实时统计

**多仓库管理** — 注册多个 Git 仓库，独立运行 Agent 进程，支持启停和代码拉取

**Git 平台集成** — 通过 MCP 统一管理 GitHub / Gitea / GitLab 的 Issue、PR、Milestone、标签

**自定义 Agent** — 基于内置 Agent 创建自定义 Agent，指定模型和 System Prompt，组合可复用的 Prompt 片段

**智能运维** — Claude 多账号自动轮换、会话中断自动恢复、截断自动续写、桌面和 iOS 推送通知

**数据持久化** — 会话、消息、工具调用、Todo 全量存入 PostgreSQL，进程重启不丢数据

## CLI

```
fourth-spark              前台启动（Ctrl-C 停止）
fourth-spark start        后台启动（含 PostgreSQL）
fourth-spark stop         停止所有服务
fourth-spark status       查看运行状态
fourth-spark upgrade      检查并更新到最新版本
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

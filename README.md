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
    └── PostgreSQL (Docker :5432)
```

- 每个 repo 对应一个独立的 OpenCode 进程，端口自动分配 (8081-8199, 127.0.0.1)
- 所有 session/event/agent API 挂在 `/api/repos/:repoId/` 下
- Git 平台操作通过 MCP server 完成，支持 GitHub / Gitea / GitLab

## 前置依赖

- [Bun](https://bun.sh/) >= 1.1
- [Docker](https://docs.docker.com/get-docker/) (用于 PostgreSQL)
- [OpenCode](https://opencode.ai/) CLI (`opencode serve`)

## 快速开始

```bash
# 1. 克隆项目
git clone <repo-url> && cd fourth-spark

# 2. 一键初始化（安装依赖 + 启动 DB + 同步 schema）
make setup

# 3. 启动开发服务
make dev
```

启动后访问 http://localhost:5173 。

## Makefile 命令

| 命令 | 说明 |
|------|------|
| `make setup` | 一键初始化：安装依赖 → 启动 DB → 同步 schema |
| `make dev` | 启动 Server + Web（自动拉起 DB） |
| `make dev-server` | 仅启动后端 API (port 3000) |
| `make dev-web` | 仅启动前端 Vite dev server (port 5173) |
| `make install` | 安装 npm 依赖 |
| `make db` | 启动 PostgreSQL 容器并等待就绪 |
| `make db-stop` | 停止 PostgreSQL 容器 |
| `make db-push` | 将 schema.ts 直接同步到数据库（开发用） |
| `make db-generate` | 对比 schema 生成 SQL migration 文件 |
| `make db-migrate` | 执行 migration 文件 |
| `make db-studio` | 打开 Drizzle Studio（数据库可视化） |
| `make status` | 查看各服务运行状态 |
| `make stop` | 停止所有服务 |
| `make stop-opencode` | 仅停止 opencode 进程 |
| `make logs` | 查看 server 和 opencode 日志 |
| `make clean` | 停止服务并清理日志 |

## 技术栈

**Server**: Bun, Hono, Drizzle ORM, PostgreSQL, Zod

**Web**: React 19, Vite, Tailwind CSS 4, Zustand, React Router, React Markdown

**Infra**: Docker Compose, OpenCode CLI

## 项目结构

```
packages/
├── server/           # 后端 API
│   ├── src/
│   │   ├── db/       # Drizzle schema + 查询
│   │   ├── lib/      # 核心逻辑 (process-manager, opencode client, claude-usage)
│   │   ├── routes/   # Hono 路由
│   │   └── middleware/
│   └── drizzle/      # Migration 文件
└── web/              # 前端 SPA
    └── src/
        ├── components/
        ├── pages/
        ├── stores/   # Zustand stores
        ├── hooks/
        └── lib/      # API client
```

## 开发说明

- 修改 server 代码后 `bun --watch` 自动重启
- 修改 web 代码后 Vite HMR 自动刷新
- DB schema 变更后执行 `make db-push`（开发）或 `make db-generate` + `make db-migrate`（生产）
- Server 启动时自动为数据库中所有已注册的 repo 拉起独立的 `opencode serve` 进程

# 开发指南

## 前置依赖

- [Bun](https://bun.sh/) >= 1.1
- [Docker](https://docs.docker.com/get-docker/)（用于 PostgreSQL）
- [OpenCode](https://opencode.ai/) CLI（`opencode serve`）

## 初始化

```bash
git clone https://github.com/kinminghao/fourth-spark.git && cd fourth-spark

make setup    # 安装依赖 → 启动 DB → 同步 schema
make dev      # 启动 Server + Web（前台）
```

开发模式访问 http://localhost:5173（Vite 代理到后端 :3000）。

## 运行方式

项目采用 Bun monorepo（`packages/server` + `packages/web`）。

- **PostgreSQL** 通过 `docker-compose` 运行（容器名 `fourth-spark-db`）
- **Server** 和 **Web** 在宿主机直接运行，不在容器里
- Server 启动时会自动为数据库中所有已注册的 repo 拉起独立的 `opencode serve` 进程

### 热重载

- 修改 server 代码后 `bun --watch` 自动重启
- 修改 web 代码后 Vite HMR 自动刷新
- Server 收到 `SIGHUP`（bun --watch 重启信号）时保留 opencode 子进程，不会中断正在运行的 Agent

## Makefile 命令

### 日常开发

| 命令 | 说明 |
|------|------|
| `make setup` | 一键初始化：安装依赖 → 启动 DB → 同步 schema |
| `make dev` | 启动 Server + Web（前台，自动拉起 DB） |
| `make run` | 后台启动所有服务，日志写入 `/tmp/fourth-spark/` |
| `make dev-server` | 仅启动后端 API (port 3000) |
| `make dev-web` | 仅启动前端 Vite dev server (port 5173) |
| `make status` | 查看各服务运行状态 |
| `make logs` | 查看 server 和 opencode 日志 |
| `make stop` | 停止所有服务 |
| `make stop-opencode` | 仅停止 opencode 进程（server 重启后会自动重新拉起） |
| `make clean` | 停止服务并清理日志 |

### 数据库

| 命令 | 说明 |
|------|------|
| `make db` | 启动 PostgreSQL 容器并等待就绪 |
| `make db-stop` | 停止 PostgreSQL 容器 |
| `make db-push` | 将 `schema.ts` 直接同步到数据库（开发用，不生成 migration） |
| `make db-generate` | 对比 schema 生成 SQL migration 文件 |
| `make db-migrate` | 执行 migration 文件 |
| `make db-studio` | 打开 Drizzle Studio（数据库可视化） |

### 构建

| 命令 | 说明 |
|------|------|
| `make build` | 构建生产版本（跨平台二进制 + 前端静态资源 + npm 包） |
| `make install` | 安装 npm 依赖 |

## Schema 变更

### 开发环境

直接修改 `packages/server/src/db/schema.ts`，然后：

```bash
make db-push
```

`drizzle-kit push` 会把 schema 定义直接同步到数据库，不生成 migration 文件。适合快速迭代。

### 生产环境

```bash
make db-generate   # 生成 SQL migration 文件到 packages/server/drizzle/
make db-migrate    # 执行 migration
```

生产环境的 Server 启动时会自动检测并执行未运行的 migration（`db/migrate.ts`）。

> **自动检测逻辑**：Server 启动时检查当前目录是否有 `drizzle.config.ts`。有 → 开发模式，自动执行 `drizzle-kit push --force`；无 → 生产模式，执行 SQL migration 文件。

## 路由结构

所有 API 路由挂在两个层级：

```
/api/                          全局路由
├── repos                      仓库 CRUD
├── settings                   全局设置 KV
├── git-hosts                  Git 平台凭证
├── health                     服务健康检查
├── usage                      用量统计
├── push                       设备 Token 注册
├── agents-md                  全局 AGENTS.md
├── custom-agents              全局自定义 Agent
└── prompt-fragments           全局 Prompt 片段

/api/repos/:repoId/            仓库作用域路由
├── sessions                   会话管理 + prompt
├── sessions/:id/events        单会话 SSE 事件流
├── events                     全局 SSE 事件流
├── agents                     内置 Agent 列表
├── custom-agents              仓库级自定义 Agent
├── prompt-fragments           仓库级 Prompt 片段
├── models                     LLM 模型列表
├── issues                     Issue 管理
├── pulls                      PR 管理
├── tags                       标签管理
├── milestones                 里程碑管理
├── mcp                        MCP 协议端点
└── health                     OpenCode 进程健康检查
```

## Git 平台操作

项目同时支持 GitHub、Gitea、GitLab，**禁止使用 `gh` CLI**。

所有 Git 平台操作通过 MCP 工具完成（`mcp/git-tools.ts`），凭证从 PostgreSQL `git_hosts` 表读取。需要本地 Git 操作时使用 `git` 命令。

## 日志

- Server 日志使用 [Pino](https://github.com/pianoforte/pino)，结构化 JSON 输出
- OpenCode 子进程日志写入 `/tmp/fourth-spark/opencode-{repoId}.log`
- 后台运行时 Server 日志写入 `/tmp/fourth-spark/server.log`

## 调试技巧

### 查看 OpenCode 子进程状态

```bash
make status
```

### 查看实时日志

```bash
make logs                    # 查看所有日志
tail -f /tmp/fourth-spark/server.log          # 跟踪 server 日志
tail -f /tmp/fourth-spark/opencode-*.log      # 跟踪所有 opencode 日志
```

### 数据库可视化

```bash
make db-studio               # 打开 Drizzle Studio (http://local.drizzle.studio)
```

### 重置 OpenCode 进程

```bash
make stop-opencode           # 杀死所有 opencode 进程
# Server 重启后会自动重新拉起
```

### PID 文件

进程管理器维护 `/tmp/fourth-spark/pid-map.json`，记录所有 opencode 子进程的 PID、端口和 repoId。Server 启动时会检查此文件，收养存活的旧进程或杀死孤儿进程。

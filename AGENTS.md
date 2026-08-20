## 开发调试

- PostgreSQL 通过 docker-compose 运行: `docker-compose up -d postgres`
- Server 和 Web 在宿主机直接运行 (不在容器里):
  - `bun run dev:server` — 后端 API (port 3000)
  - `bun run dev:web` — 前端 Vite dev server (port 5173)
- Server 启动时会自动为数据库中所有已注册的 repo 拉起独立的 `opencode serve` 进程
- 修改 server 代码后 bun --watch 自动重启; 修改 web 代码后 Vite HMR 自动刷新
- DB schema 变更后需要执行 `bunx drizzle-kit push` (在 packages/server 下)

## 架构

```
Frontend (React+Vite :5173)
    │
    ▼
Server (Bun+Hono :3000, HTTPS :3443)
    │
    ├── RuntimeManager (core/runtime-manager.ts)
    │   ├── OpenCodeProvider   → opencode serve :8081-8199 (HTTP, 一个进程/repo)
    │   ├── ClaudeCodeProvider → claude -p (stdio, 一个子进程/session)
    │   └── ... (可插拔 RuntimeProvider)
    │
    ├── SyncScheduler ── 每小时自动同步 Issue/PR/Milestone/Comment/Tag
    ├── SenseVoice ───── 本地语音转文字
    ├── TLS Manager ──── 自签证书 LAN HTTPS
    │
    └── PostgreSQL (docker :5432)
```

- 每个 repo 对应一个独立的 Agent 运行时, 类型由 `repos.runtimeType` 决定 (默认 opencode)
- OpenCode: 端口自动分配 (8081-8199, 127.0.0.1), HTTP API
- Claude Code: 每个 session 按需 spawn `claude -p` 子进程, stdio 通信
- 所有 session/event/agent API 挂在 `/api/repos/:repoId/` 下
- Repo CRUD API 在 `/api/repos`

## Git 平台操作 (MCP)

每个 opencode 实例自动配置了 `fourth-spark-git` MCP server，提供以下工具：

| 工具 | 说明 |
|------|------|
| `get_repo_info` | 获取当前仓库的 owner/repo/host/platform |
| `list_issues` | 列出 issue (支持 state 筛选和分页) |
| `get_issue` | 按编号获取单个 issue |
| `create_issue` | 创建 issue |
| `update_issue` | 更新 issue (标题/正文/状态) |
| `create_comment` | 给 issue 添加评论 |
| `list_comments` | 列出 issue 的评论 |
| `list_pull_requests` | 列出 PR (支持 state 筛选和分页) |
| `get_pull_request` | 按编号获取单个 PR (含 diff stats) |
| `create_pull_request` | 创建 PR (需指定 head/base 分支)；可选 issue_number 自动关联 issue |
| `list_pr_comments` | 列出 PR 的评论 |
| `create_pr_comment` | 给 PR 添加评论 |
| `merge_pull_request` | 合并 PR |

- 凭证自动从 PostgreSQL `git_hosts` 表读取，按仓库 remote URL 中的 host 匹配
- 支持 GitHub、Gitea、GitLab 平台
- MCP endpoint: `http://127.0.0.1:3000/api/repos/:repoId/mcp`
- ProcessManager 启动 opencode 时自动注入 `opencode.json` 中的 MCP 配置，停止时清理
- **禁止使用 `gh` CLI**：项目同时支持 GitHub、Gitea、GitLab，`gh` 只适用于 GitHub。所有 Git 平台操作必须通过上述 MCP 工具完成；需要本地 Git 操作时使用 `git` 命令

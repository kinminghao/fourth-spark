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
Server (Bun+Hono :3000)
    │
    ├── ProcessManager
    │   ├── Repo A → opencode serve :8081 (cwd /path/a)
    │   ├── Repo B → opencode serve :8082 (cwd /path/b)
    │   └── ...
    │
    └── PostgreSQL (docker :5432)
```

- 每个 repo 对应一个独立的 opencode 进程, 端口自动分配 (8081-8199, 127.0.0.1)
- 所有 session/event/agent API 挂在 `/api/repos/:repoId/` 下
- Repo CRUD API 在 `/api/repos`

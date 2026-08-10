# 多仓库管理

注册多个 Git 仓库，每个仓库独立运行 OpenCode Agent 进程，支持完整的生命周期管理。

## 仓库注册

### 路径解析

注册前通过 `POST /api/repos/resolve` 自动解析：

- 验证本地路径存在且是 Git 仓库（检查 `.git` 目录）
- 提取仓库名（目录名）
- 读取 `remote.origin.url` 作为 Git URL
- 前端 `AddRepoModal` 提供输入框，粘贴路径后自动填充

### 注册流程

1. 前端提交 `name` / `gitUrl` / `localPath`
2. 写入 `repos` 表（`localPath` 唯一索引防止重复注册）
3. 立即为该仓库启动 OpenCode 进程
4. 返回仓库信息（含端口和状态）

## 进程管理

每个仓库对应一个独立的 `opencode serve` 进程：

### 启动

- 自动分配空闲端口（范围 8081–8199）
- 先检查端口是否被占用（HTTP 探测）
- 启动参数：`opencode serve --port N --hostname 127.0.0.1 --print-logs --log-level DEBUG`
- 进程以 detached 模式运行，日志写入 `/tmp/fourth-spark/opencode-{repoId前8位}.log`
- 等待进程就绪（轮询 `/agent` 端点，30 秒超时）
- 注入 MCP 配置到仓库的 `opencode.json`（自动添加 `fourth-spark-git` MCP server）

### 停止

- 发送 SIGTERM 终止进程
- 从 `opencode.json` 清理 MCP 配置
- 更新数据库状态为 `inactive`

### 孤儿进程管理

服务重启时自动处理上一轮遗留的 OpenCode 进程：

1. 读取 `/tmp/fourth-spark/pid-map.json`（PID + 端口 + repoId 映射）
2. 检查进程是否存活（`kill(pid, 0)`）
3. 验证进程身份（HTTP 请求确认 directory 匹配）
4. 匹配成功 → 复用进程（避免重启）
5. 匹配失败 → 杀掉进程
6. 额外通过 `pgrep -f 'opencode serve --port'` 查杀漏网的 stray 进程

### 初始数据同步

进程启动后自动执行初始同步：

- 拉取所有 Session 列表 → upsert 到 `sessions` 表
- 逐个拉取 Session 的消息 → upsert 到 `messages` + `parts` 表

## 分支管理

| 操作 | API | 说明 |
|------|-----|------|
| 查看分支 | `GET /api/repos/:id/branches` | 返回当前分支、本地分支列表、远程分支列表 |
| 切换分支 | `POST /api/repos/:id/checkout` | 执行 `git checkout <branch>` |
| 拉取代码 | `POST /api/repos/:id/pull` | 执行 `git pull --ff-only --autostash`，分叉时返回错误提示 |

前端导航栏显示当前分支名，点击展开分支选择器。

## 仓库状态

| 状态 | 含义 |
|------|------|
| `active` | OpenCode 进程正在运行 |
| `inactive` | 进程已停止 |
| `error` | 启动失败 |

前端仓库列表显示运行状态指示灯和端口号。

## 仓库操作 UI

`ReposPage` 提供：

- 仓库卡片列表（名称、Git URL、本地路径、状态、分支、端口）
- 启动 / 停止按钮
- 代码拉取按钮
- Worktree 开关
- Workspace 列表和管理（磁盘用量、状态、删除、批量清理）
- 删除仓库（确认后停止进程 + 删除数据库记录）
- 直接访问 OpenCode 端口的链接

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/repos/resolve` | 解析本地路径 |
| `POST` | `/api/repos` | 注册仓库 |
| `GET` | `/api/repos` | 列出所有仓库 |
| `GET` | `/api/repos/:id` | 获取单个仓库 |
| `DELETE` | `/api/repos/:id` | 删除仓库 |
| `POST` | `/api/repos/:id/start` | 启动进程 |
| `POST` | `/api/repos/:id/stop` | 停止进程 |
| `GET` | `/api/repos/:id/branches` | 列出分支 |
| `POST` | `/api/repos/:id/checkout` | 切换分支 |
| `POST` | `/api/repos/:id/pull` | 拉取代码 |
| `PATCH` | `/api/repos/:id/worktree` | Worktree 开关 |

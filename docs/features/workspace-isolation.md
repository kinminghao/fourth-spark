# Workspace 隔离

基于 Git Worktree 的任务级分支隔离，每个 Session 可在独立的工作目录中运行，互不干扰。

## 工作原理

```
主仓库 (main)
    ├── worktree ws/a1b2c3d4  →  ~/.fourth-spark/worktrees/{repoId}-a1b2c3d4/
    ├── worktree ws/e5f6g7h8  →  ~/.fourth-spark/worktrees/{repoId}-e5f6g7h8/
    └── ...
```

开启 Worktree 功能后，每次创建 Session 时自动创建新的 Git Worktree，Agent 在隔离的分支和目录中工作，不影响主仓库状态。

## 功能点

### 创建 Workspace

- 在 `~/.fourth-spark/worktrees/` 下创建工作目录
- 分支名格式：`ws/{8位短ID}`（如 `ws/a1b2c3d4`）
- 自动检测主仓库当前分支作为 `base_branch`
- 自动 symlink 主仓库的 `AGENTS.md` 到 worktree（若主仓库有、worktree 没有）
- 创建完成后为该 Workspace 分配独立的 OpenCode 进程端口

### 状态追踪

Workspace 状态动态计算（非存储），每次查询时实时评估：

| 状态 | 条件 |
|------|------|
| `active` | 有 `busy` 状态的 Session 在运行 |
| `idle` | 无活跃 Session，且分支未合并 |
| `merged` | 分支已合并到 base_branch（通过 `git merge-base --is-ancestor` 检测） |
| `stale` | 已合并且超过 7 天未更新 |

### 磁盘用量

- 每个 Workspace 查询时通过 `du -sb` 计算磁盘占用
- 前端列表显示各 Workspace 的磁盘大小

### 删除保护

- `active` 状态的 Workspace 禁止删除（HTTP 409）
- 删除时执行：`git worktree remove --force` → `git branch -D` → 数据库删除
- 即使 git 操作失败也会继续清理数据库记录

### 批量清理

`POST /api/repos/:repoId/workspaces/cleanup` 一键清理：

- 自动跳过 `active`（有活跃 Session）的 Workspace
- 自动跳过未合并且非 stale 的 Workspace
- 只删除 `merged` 或 `stale` 状态的 Workspace
- 返回清理结果（已删除列表 + 跳过列表及原因）

### PR 创建时自动重命名分支

Agent 通过 MCP 创建 PR 时，`git-tools.ts` 自动将临时分支名（`ws/a1b2c3d4`）重命名为语义化分支名（如 `feature/add-auth`），并更新数据库记录。

## 按仓库开关

- 每个仓库可独立开启或关闭 Worktree 功能
- `PATCH /api/repos/:id/worktree` — `{ enabled: true/false }`
- 关闭后创建 Session 直接在主仓库目录运行
- 仓库列表 UI 提供 Worktree 开关

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/repos/:repoId/workspaces` | 列出 Workspace（含状态、磁盘用量、是否可删除） |
| `DELETE` | `/api/repos/:repoId/workspaces/:id` | 删除单个 Workspace |
| `POST` | `/api/repos/:repoId/workspaces/cleanup` | 批量清理已合并的 Workspace |
| `PATCH` | `/api/repos/:repoId/worktree` | 开启/关闭仓库的 Worktree 功能 |

## 存储路径

| 内容 | 路径 |
|------|------|
| Worktree 目录 | `~/.fourth-spark/worktrees/{repoId}-{shortId}/` |
| 数据库记录 | `workspaces` 表 |

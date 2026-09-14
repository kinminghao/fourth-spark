# Contributing to Fourth Spark

## 开发环境

### 前置要求

- [Bun](https://bun.sh/) ≥ 1.3
- [Docker](https://docs.docker.com/get-docker/)（用于 PostgreSQL）
- [OpenCode](https://opencode.ai/) CLI 和/或 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI

### 快速开始

```bash
git clone https://github.com/kinminghao/fourth-spark.git
cd fourth-spark
cp .env.example .env          # 按需修改环境变量
make setup                    # 安装依赖 + 启动 DB + 同步 schema
make dev                      # 启动 Server (:3000) + Web (:5173)
```

开发模式访问 http://localhost:5173。

### 常用命令

| 命令 | 说明 |
|------|------|
| `make setup` | 首次搭建：安装依赖 + 启动 DB + 推送 schema |
| `make dev` | 启动 server + web（前台） |
| `make dev-server` | 只启动 server |
| `make dev-web` | 只启动 web |
| `make db` | 启动 PostgreSQL |
| `make db-push` | 推送 schema 变更 |
| `make db-studio` | 打开 Drizzle Studio |
| `make build` | 构建所有包 |
| `make status` | 查看服务状态 |
| `make stop` | 停止所有服务 |

完整命令列表见 [`Makefile`](Makefile)。

环境变量说明见 [`.env.example`](.env.example)。

## 项目结构

```
fourth-spark/
├── packages/
│   ├── server/      # Bun + Hono 后端
│   └── web/         # React 19 + Vite 前端
├── npm/             # CLI 分发包
├── scripts/         # 构建脚本
├── Makefile         # 开发命令
└── biome.json       # Linter & Formatter 配置
```

## 开发流程

1. Fork 仓库并 clone 到本地
2. 创建分支：`git checkout -b feature/your-feature` 或 `fix/your-fix`
3. 开发 & 测试
4. 提交 PR 到 `main` 分支

### 分支命名

| 前缀 | 用途 |
|------|------|
| `feature/` | 新功能 |
| `fix/` | Bug 修复 |
| `docs/` | 文档改动 |
| `refactor/` | 重构 |
| `chore/` | 工程杂项 |

## 代码规范

项目使用 [Biome](https://biomejs.dev/) 进行 lint 和格式化，配置见 [`biome.json`](biome.json)。

```bash
bun run lint          # 检查
bun run lint:fix      # 自动修复
```

提交前请确保 `bun run lint` 通过。

## Commit 与 PR

### Commit Message

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <description>

[optional body]
```

**Type**：`feat` | `fix` | `docs` | `chore` | `refactor` | `test` | `ci` | `perf` | `style` | `build` | `revert`

示例：

```
feat(agent): add memory consolidation scheduling
fix(api): handle null response in session monitor
docs: update contributing guide
chore: upgrade biome to 2.x
```

### PR 规范

- PR 标题同样遵循 Conventional Commits 格式（CI 会检查）
- 关联 Issue：在 PR 描述中写 `Closes #123`
- 确保 CI 全绿：lint + typecheck + tests

## 测试

```bash
bun run test          # 全部单元测试（server + web）
bun run test:server   # 仅 server 单元测试
bun run test:web      # 仅 web 测试
bun run test:db       # DB 集成测试（需要 PostgreSQL）
```

新功能请附带测试。

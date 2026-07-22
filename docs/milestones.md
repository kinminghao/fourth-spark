# Fourth Spark — Milestones

> **Project:** Fourth Spark — AI Agent Platform
> **Date:** 2026-07-21
> **Depends on:** [custom-agent-platform-research.md](./custom-agent-platform-research.md)
> **Stack:** TypeScript fullstack, frontend/backend separation, backend designed for future replacement
> **Developer:** Solo

---

## Overview

```
MVP    Agent Chat 可用版         ──  2-3 weeks  ── 能跑通的 Web Agent Chat
─── MVP 交付线 ──────────────────────────────────────────────────
F1   Session 持久化              ── 数据不丢, 可搜索
F2   自定义 Agent 模板           ── Web 上定义 agent
F3   自定义 Skill / MCP 注入     ── Web 上管理 skill 和 MCP
F4   容器化                     ── Docker 镜像, docker-compose 一键跑
F5   K8s Pod 隔离               ── 每个 session 独立 Pod 执行
F6   多租户                     ── 用户/租户/Key 隔离
F7   业务层 API                  ── Webhook, 定时触发, 批量执行
F8   多端适配                   ── PWA, 移动端响应式
```

---

## MVP — Fourth Spark Agent Chat

> **目标:** 浏览器打开 → 选 agent → 发消息 → 实时看到 agent 干活 → 多轮对话 → 切换/回看 session.
> **时间:** 2-3 weeks
> **前置:** 本地有可用的 OpenCode + omo + LLM API key

### 架构

```
┌──────────────┐      ┌──────────────────┐      ┌──────────────────┐
│   Frontend   │ ←──→ │   Backend API    │ ←──→ │  OpenCode serve  │
│  React+Vite  │      │   Bun + Hono     │      │  localhost:8080  │
│  port 5173   │      │   port 3000      │      │  (+ omo plugin)  │
└──────────────┘      └──────────────────┘      └──────────────────┘
```

前后端分离. 前端只跟后端 API 通信, 不直接碰 OpenCode.
后端是无状态代理层, 不持有业务数据 (MVP 阶段).

### 技术选型

| 模块 | 选择 | 理由 |
|------|------|------|
| **后端 Runtime** | Bun | 与 omo 一致, 原生 TS, 快 |
| **后端 Framework** | Hono | 轻量, 类型安全, SSE 原生支持, 跨 runtime |
| **OpenCode Client** | `@opencode-ai/sdk` | 官方 SDK, 全类型覆盖 |
| **前端 Framework** | React 19 + Vite | 生态成熟, 快速启动 |
| **状态管理** | Zustand | 轻量, SSE 事件驱动友好 |
| **UI 组件** | shadcn/ui | 可定制, 不锁定, 复制不依赖 |
| **Markdown 渲染** | react-markdown + rehype | 成熟 |
| **代码高亮** | Shiki | VS Code 级高亮 |

### 后端 API

```
POST   /api/sessions                 创建 session (指定 agent)
GET    /api/sessions                 列出 session
GET    /api/sessions/:id             获取 session 详情
DELETE /api/sessions/:id             删除 session
POST   /api/sessions/:id/prompt      发送消息 (代理到 OpenCode)
POST   /api/sessions/:id/abort       中止 session
GET    /api/sessions/:id/messages    获取消息历史
GET    /api/sessions/:id/todos       获取 todo 列表
GET    /api/sessions/:id/events      SSE 事件流代理 (核心)
GET    /api/agents                   列出可用 agent
GET    /api/health                   健康检查
```

所有接口本质上是对 OpenCode SDK 的薄封装:
- 统一错误格式
- 结构化日志
- CORS 处理
- 未来扩展点 (认证/持久化/多租户 都加在这一层)

### 前端页面

```
┌─────────────────────────────────────────────────────────────┐
│  Sidebar                │  Main Area                        │
│                         │                                   │
│  ┌───────────────────┐  │  ┌─────────────────────────────┐  │
│  │ + New Session     │  │  │  Session: 重构 auth 模块     │  │
│  │   Agent: [▾ 选择] │  │  │                             │  │
│  │                   │  │  │  [User]                     │  │
│  │ Recent            │  │  │  分析现有 auth 架构          │  │
│  │ ├ 重构 auth       │  │  │                             │  │
│  │ ├ Fix bug #42     │  │  │  [Sisyphus]                 │  │
│  │ └ Deploy prep     │  │  │  正在分析...                 │  │
│  │                   │  │  │  ┌─ Read src/auth/... ────┐  │  │
│  │                   │  │  │  │  input: { path: ... }  │  │  │
│  │                   │  │  │  │  output: (折叠)        │  │  │
│  │                   │  │  │  └────────────────────────┘  │  │
│  │                   │  │  │  ┌─ Grep "middleware" ────┐  │  │
│  │                   │  │  │  │  ...                   │  │  │
│  │                   │  │  │  └────────────────────────┘  │  │
│  │                   │  │  │                             │  │
│  │                   │  │  │  [Todo]                     │  │
│  │                   │  │  │  ✅ 分析现有架构             │  │
│  │                   │  │  │  ⬜ 重构 auth middleware    │  │
│  │                   │  │  │  ⬜ 更新测试               │  │
│  └───────────────────┘  │  └─────────────────────────────┘  │
│                         │                                   │
│                         │  ┌─────────────────────────────┐  │
│                         │  │ [消息输入框]           Send  │  │
│                         │  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 前端功能

| 功能 | 说明 |
|------|------|
| Session 列表 | 左侧栏, 按时间排序, 点击切换 |
| 新建 Session | 选 agent + 输入消息 |
| 消息流 | 实时 streaming, Markdown + 代码高亮 |
| 工具调用 | 折叠面板: 工具名 → 参数 → 结果 |
| Todo 进度 | 实时状态更新 (pending/in_progress/completed) |
| 多轮对话 | 同一 session 连续发消息 |
| 历史回看 | 打开旧 session 查看完整消息 |
| 中止 Session | 一键中止正在执行的 session |
| 响应式布局 | 手机也能凑合看 |

### 核心数据流

```
用户输入 "分析 auth 架构"
     │
     ▼
Frontend: POST /api/sessions/:id/prompt
     │
     ▼
Backend: 代理到 OpenCode session.prompt()
     │
     ▼
Frontend: 订阅 GET /api/sessions/:id/events (SSE)
     │
     ▼  收到事件流:
     │
     ├─ message.part.updated  → 更新消息气泡 (streaming 文字)
     ├─ tool.execute          → 添加工具调用面板
     ├─ tool.result           → 填充工具结果
     ├─ todo.updated          → 更新 todo 列表
     ├─ session.status        → 更新状态 (busy/idle)
     └─ session.idle          → 标记完成, 解锁输入框
```

### 项目结构

```
fourth-spark/                    # monorepo root
├── packages/
│   ├── server/                  # 后端
│   │   ├── src/
│   │   │   ├── index.ts         # 入口, Hono app
│   │   │   ├── routes/
│   │   │   │   ├── sessions.ts  # Session CRUD + prompt
│   │   │   │   ├── events.ts    # SSE 代理
│   │   │   │   └── agents.ts    # Agent 列表
│   │   │   ├── lib/
│   │   │   │   └── opencode.ts  # OpenCode SDK 封装
│   │   │   └── middleware/
│   │   │       ├── logger.ts
│   │   │       ├── cors.ts
│   │   │       └── errors.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                     # 前端
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── SessionList.tsx
│       │   │   ├── ChatView.tsx
│       │   │   ├── MessageBubble.tsx
│       │   │   ├── ToolCallPanel.tsx
│       │   │   ├── TodoProgress.tsx
│       │   │   └── InputBar.tsx
│       │   ├── stores/
│       │   │   └── session-store.ts
│       │   ├── hooks/
│       │   │   └── use-session-events.ts
│       │   └── lib/
│       │       └── api-client.ts
│       ├── package.json
│       └── vite.config.ts
│
├── package.json                 # workspace root
└── tsconfig.json
```

### 成功标准

- [ ] `bun run dev` 启动后端 + 前端
- [ ] 浏览器打开 → 看到 session 列表 → 新建 session → 选 agent → 发消息
- [ ] 实时看到 agent 的工具调用过程 (折叠面板展示参数和结果)
- [ ] 消息流式渲染, Markdown 格式正确, 代码块有语法高亮
- [ ] Todo 进度实时更新
- [ ] 在同一 session 发第二条消息, 上下文延续
- [ ] 切换到旧 session, 能看到完整历史消息
- [ ] 一键中止正在运行的 session
- [ ] 手机浏览器打开, 布局不崩

### 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| OpenCode serve API 与 SDK 类型不一致 | 接口调不通 | 开工第一天先跑通核心 API (create → prompt → events) |
| SSE 事件格式文档不足 | 不知道怎么解析 | 先写一个事件 dump 脚本, 记录真实事件格式 |
| CORS / 认证问题 | 前端连不上 | 后端代理层天然解决 CORS |
| 消息结构复杂 (parts, delta) | UI 渲染困难 | MVP 先处理 text + tool 两种 part, 其他类型 fallback 为 JSON |

### 不含 (MVP 后再做)

- 数据持久化 (session 在 OpenCode 进程里, 重启丢失)
- 自定义 agent/skill/MCP 定义
- 容器化
- K8s Pod 隔离
- 多租户 / 认证
- Webhook / 自动触发

---

## Post-MVP Features

每个 Feature 独立可交付. 做完一个就能用, 不做下一个不影响.
顺序是建议顺序, 可按需调整.

### F1 — Session 持久化

> **解决:** OpenCode 进程重启后 session 数据丢失.

**方案:** 后端消费 SSE 事件, 双写到 PostgreSQL. 旧 session 直接从 PG 读.

**新增/变更:**
- 后端新增 PostgreSQL 连接 (Drizzle ORM)
- 表: sessions, messages, message_parts, todos, tool_calls
- SSE 事件消费者: 实时解析事件写入 PG
- 历史 session 列表/消息从 PG 读取
- Session 搜索 API (PostgreSQL tsvector)

**成功标准:**
- 重启 OpenCode 后, Web UI 仍能查看所有历史 session
- 按关键词搜索能找到历史对话

---

### F2 — 自定义 Agent 模板

> **解决:** Agent 只能通过配置文件预定义, 不能在 Web 上管理.

**方案:** 配置模板系统. Web 上定义 agent (model / prompt / permissions), 存 PG, 创建 session 时生成配置文件注入.

**新增/变更:**
- 后端: agent_templates 表 + CRUD API
- 前端: Agent 模板管理页面 (列表 / 创建 / 编辑)
- 创建 session 时: 从模板生成 `.opencode/oh-my-openagent.jsonc` 写入 workspace
- 需要解决: 配置变更后 OpenCode 重新加载的机制

**成功标准:**
- Web 上创建一个自定义 agent (指定 model, system prompt)
- 创建 session 时选择该自定义 agent, 行为符合预期

---

### F3 — 自定义 Skill / MCP 注入

> **解决:** Skill 和 MCP 只能通过文件系统定义.

**方案:**
- Skill: Web 上编辑 SKILL.md 内容, 存 PG, 创建 session 时写入 `.opencode/skills/*/SKILL.md`
- MCP: 运行时通过 OpenCode API `mcp.add` / `mcp.connect` 动态添加

**新增/变更:**
- 后端: skill_templates 表 + mcp_templates 表 + CRUD API
- 前端: Skill / MCP 管理页面
- Session 创建流程: 注入 skill 文件 + 动态连接 MCP

**成功标准:**
- Web 上创建一个 skill, agent 在 session 中能使用它
- Web 上添加一个 MCP server, agent 能调用其工具

---

### F4 — 容器化

> **解决:** 开发环境部署复杂, 无法一键启动.

**方案:** Docker 镜像 + docker-compose. 三个服务: OpenCode executor, API server, Web UI. 加 PostgreSQL + Redis.

**新增/变更:**
- Dockerfile (multi-stage: executor / api-server / web)
- docker-compose.yml
- 环境变量管理 (.env)

**成功标准:**
- `docker-compose up` 一键启动
- 浏览器访问能完成完整工作流
- 重启后数据不丢 (PG volume)

**前置:** F1 (持久化) 完成, 否则容器重启数据全丢

---

### F5 — K8s Pod 隔离

> **解决:** 所有 session 共享同一个 OpenCode 进程, 无隔离.

**方案:** 每次创建 session 动态启动 K8s Job. Init Container 注入配置, Main Container 跑 OpenCode serve, Sidecar 收集事件. 完成后销毁 Pod.

**新增/变更:**
- K8s Job 模板 (动态生成)
- Init Container: 配置注入器
- Sidecar: SSE → Redis Pub/Sub → API Server
- API Server: K8s client, Pod 生命周期管理
- Pod 结束前 SQLite 数据归档

**成功标准:**
- 不同 session 在不同 Pod, 互相隔离
- Pod 销毁后 session 数据可查
- Pod 启动 < 30s (镜像缓存)

**前置:** F4 (容器化) 完成

---

### F6 — 多租户

> **解决:** 单用户, 无认证, 无数据隔离.

**方案:** JWT 认证, 所有数据按 tenant_id 隔离, Provider API key 加密存储 per-tenant.

**新增/变更:**
- 表: tenants, users, provider_keys, usage_records
- 认证中间件 (JWT)
- 所有查询加 tenant_id 过滤
- Provider key 加密存储 (AES-256-GCM)
- 用量统计 + 配额限制

**成功标准:**
- 两个用户各自只看到自己的数据
- 租户 A 的 API key 不会泄露给租户 B
- 超配额返回 429

---

### F7 — 业务层 API

> **解决:** 只能手动在 Web 上操作, 无法自动化.

**方案:** API Key 认证 + Webhook + 定时触发 + 批量执行 + Prompt 模板.

**新增/变更:**
- API Key 管理 (生成 / 撤销)
- Webhook 配置 (session 完成/失败时回调)
- Cron 定时触发
- 批量 session 创建 API
- Prompt 模板 (变量替换)

**成功标准:**
- CI/CD 通过 API Key 触发 agent session
- Session 完成后 webhook 回调
- 批量提交 10 个 session 并行执行

**前置:** F6 (多租户) 完成

---

### F8 — 多端适配

> **解决:** 只能在桌面浏览器使用.

**方案:** PWA (渐进式 Web App). MVP 阶段的响应式布局打底, 加 Service Worker + manifest + 推送通知.

**新增/变更:**
- PWA manifest + Service Worker
- 离线缓存历史 session
- Push notification (session 完成通知)
- 添加到主屏幕

**成功标准:**
- 手机添加到主屏幕, 体验接近原生 App
- Session 完成时收到推送通知
- 离线能查看历史 session

---

## Feature 依赖关系

```
MVP (Agent Chat 可用版)
 │
 ├── F1 (持久化)
 │    │
 │    └── F4 (容器化)
 │         │
 │         └── F5 (K8s)
 │              │
 │              └── F6 (多租户)
 │                   │
 │                   └── F7 (业务层)
 │
 ├── F2 (自定义 Agent) ── 独立, MVP 后随时可做
 │
 ├── F3 (自定义 Skill/MCP) ── 独立, MVP 后随时可做
 │
 └── F8 (多端) ── 独立, MVP 后随时可做
```

**关键路径:** MVP → F1 → F4 → F5 → F6 → F7
**可随时插入:** F2, F3, F8 不在关键路径上, 按需穿插

---

## Checkpoint

| 节点 | 检查 | 决策 |
|------|------|------|
| MVP 第 1 天 | OpenCode serve API 跑通了吗? (create → prompt → events) | 不通 → 排查, 严重问题 → 重评方案 |
| MVP 交付 | Web 上能完成完整的 agent 对话吗? | 能 → 继续 F1; 体验差 → 先打磨 UI |
| F1 完成 | 持久化可靠吗? 重启不丢数据? | 可靠 → F4; 不可靠 → 修 |
| F4 完成 | 容器化性能可接受吗? | 可接受 → F5; 太重 → 优化镜像 |
| F5 完成 | 还需要继续用 OpenCode 当执行器吗? | 天花板明显 → 考虑自建引擎 (omo Core 包) |

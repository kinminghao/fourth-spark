# 自定义 Agent

基于内置 Agent 创建自定义 Agent，组合模型、System Prompt 和可复用的 Prompt 片段。

## 概念模型

```
Custom Agent = Base Agent + 模型覆盖 + [片段1, 片段2, ..., 补充指令, ..., 片段N]
                                          └── 位置可拖拽排序 ──┘
```

## Base Agent

自定义 Agent 必须基于一个 Base Agent。可选项由两部分组成：

**内置 Base Agent**

| Base Agent | 用途 |
|-----------|------|
| Sisyphus - ultraworker | 通用代码开发 |
| Prometheus - Plan Builder | 计划制定 |
| Atlas - Plan Executor | 计划执行 |
| Hephaestus - Deep Agent | 深度任务执行（仅支持 GPT 模型） |

内置列表以 `packages/server/src/lib/base-agents.ts` 的 `BUILTIN_BASE_AGENTS` 为准。

**本地自定义 Agent**

服务端扫描 `~/.config/opencode/agents` 和 `~/.config/opencode/agent` 下的 Markdown 文件，把可作为 primary session 使用的 Agent 加入可选列表：

- Agent 名称取文件名（去掉 `.md`），或 frontmatter 的 `name`
- `description` 从 frontmatter 读取
- `mode: subagent` 的条目会被排除
- `disable: true` 的条目会被排除

内置 Base Agent 提供基础的工具权限和行为模式，Custom Agent 在其上叠加自定义指令。本地 Agent 必须存在于 OpenCode 运行时；运行时找不到时 `resolveAgent` 会忽略并回退到默认 Agent。

对应接口：`GET /api/base-agents`，返回 `name`、`description`、`source`。

> 扫描目录与全局 AGENTS.md 使用同一个 OpenCode 配置根目录（`~/.config/opencode`）。新增本地 Agent 后刷新 Agents 页面即可看到。

## Base Agent 预设

Agents 页面的「新增基础配置」入口可以把内置的 Base Agent 配置写入本机 OpenCode 用户配置目录。当前内置：

| 预设 | Agent 名称 | 用途 |
|------|------------|------|
| chat bot | `chat` | 对话式技术讨论，按需执行仓库改动 |

安装会写入 `~/.config/opencode/agents/chat.md`；文件已存在时不会覆盖。安装后 `GET /api/base-agents` 会立即扫描到该 Agent，但 OpenCode 运行时需要重启对应仓库后才会加载它。多设备场景下，在每台设备的 Fourth Spark 页面分别点击安装即可。

对应接口：

- `GET /api/base-agents/presets`
- `POST /api/base-agents/presets/:id/install`

预设内容以 `packages/server/src/lib/base-agent-presets.ts` 的 `BASE_AGENT_PRESETS` 为准。

## Prompt 片段

可复用的提示词模块，可在多个 Custom Agent 间共享。

### 片段属性

| 字段 | 说明 |
|------|------|
| `name` | 片段名称 |
| `content` | 提示词内容（Markdown） |
| `repo_id` | 绑定仓库（null 为全局） |
| `sort_order` | 排序权重 |

### 作用域

- **全局片段**（`repo_id = null`）：对所有仓库可见
- **仓库片段**（`repo_id = xxx`）：仅对指定仓库可见

### 片段 CRUD

| 操作 | 全局 API | 仓库级 API |
|------|----------|-----------|
| 列出 | `GET /api/prompt-fragments` | `GET /api/repos/:repoId/prompt-fragments` |
| 创建 | `POST /api/prompt-fragments` | `POST /api/repos/:repoId/prompt-fragments` |
| 更新 | `PUT /api/prompt-fragments/:id` | 同左 |
| 删除 | `DELETE /api/prompt-fragments/:id` | 同左 |

## Agent 组合

### 提示词拼接

创建 Custom Agent 时，选择片段并排序，最终 System Prompt 按顺序拼接：

```
[片段 A 内容]

---

[补充指令内容]     ← systemPrompt 字段，位置由 systemPromptPosition 控制

---

[片段 B 内容]
```

`systemPromptPosition` 表示补充指令在片段序列中的插入位置（0 = 最前，-1 = 最后）。

### 预览

设置页面提供"预览最终提示词"功能，实时显示片段 + 补充指令的拼接结果。

### 模型覆盖

- 每个 Custom Agent 可指定模型（从钉选的常用模型列表中选择）
- 不指定时使用 Session 的默认模型
- 模型列表来自 OpenCode 进程的可用模型

## 系统 Agent

内置的系统级 Agent，`is_system = 1`，不可被用户删除：

| Agent | 用途 |
|-------|------|
| 评论助手 | Issue 评论润色，读取草稿文件 → 理解 Issue 上下文 → 润色评论 → 写回文件 |

系统 Agent 在服务启动时自动 seed（`seedSystemAgents`），已存在则跳过。

## 导入 / 导出

### 导出

- **下载 JSON**：将 Custom Agent（含关联的 Prompt 片段）导出为 `.json` 文件
- **复制到剪贴板**：同上，但复制到剪贴板

导出格式：

```json
{
  "type": "fourth-spark-custom-agent",
  "version": 1,
  "agent": {
    "name": "...",
    "baseAgent": "...",
    "model": "...",
    "systemPrompt": "...",
    "systemPromptPosition": 0
  },
  "fragments": [
    { "name": "...", "content": "..." }
  ]
}
```

### 导入

- **上传 JSON 文件**或**粘贴 JSON 内容**
- 验证格式（`type` 必须为 `fourth-spark-custom-agent`）
- 自动创建 Agent 和关联的 Prompt 片段
- 片段按名称去重（已存在同名片段则复用）

## 作用域

| 类型 | `repo_id` | 可见范围 |
|------|-----------|---------|
| 全局 Agent | `null` | 所有仓库的 Session |
| 仓库 Agent | `xxx` | 仅该仓库的 Session |

查询时合并全局和仓库级 Agent，前端标记仓库级 Agent 为"repo"标签。

## Agent CRUD API

| 操作 | 全局 API | 仓库级 API |
|------|----------|-----------|
| 列出 | `GET /api/custom-agents` | `GET /api/repos/:repoId/custom-agents` |
| 创建 | `POST /api/custom-agents` | `POST /api/repos/:repoId/custom-agents` |
| 更新 | `PUT /api/custom-agents/:id` | 同左 |
| 删除 | `DELETE /api/custom-agents/:id` | 同左 |
| 导出 | `GET /api/custom-agents/:id/export` | 同左 |
| 导入 | `POST /api/custom-agents/import` | 同左 |

## AGENTS.md 编辑

除了 Custom Agent，还支持直接编辑 AGENTS.md：

| 级别 | 路径 | API |
|------|------|-----|
| 全局 | `~/.config/opencode/AGENTS.md` | `GET/PUT /api/agents-md` |
| 仓库级 | `{repoLocalPath}/AGENTS.md` | `GET/PUT /api/repos/:id/agents-md` |

全局 AGENTS.md 注入到所有仓库的 Agent 系统指令中，修改后 OpenCode 热加载即时生效。

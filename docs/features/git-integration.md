# Git 平台集成

通过 MCP 和 REST API 统一管理 GitHub / Gitea / GitLab 的 Issue、PR、Milestone 和标签。

## 多平台支持

支持三种 Git 托管平台，通过 `git_hosts` 表按 host 匹配凭证：

| 平台 | API 基础路径 | 认证方式 |
|------|-------------|---------|
| **Gitea** | `https://{host}/api/v1/` | `Authorization: token {token}` |
| **GitHub** | `https://api.github.com/` | `Authorization: Bearer {token}` |
| **GitLab** | `https://{host}/api/v4/` | `PRIVATE-TOKEN: {token}` |

凭证来源优先级：数据库 `git_hosts` 表 → 环境变量 `GITEA_TOKEN`（全局 fallback）。

## MCP Git 工具

每个 OpenCode 进程自动配置 `fourth-spark-git` MCP server，Agent 可直接调用以下工具：

| 工具 | 说明 |
|------|------|
| `get_repo_info` | 获取仓库的 owner / repo / host / platform |
| `list_issues` | 列出 Issue（支持 state 筛选和分页） |
| `get_issue` | 按编号获取单个 Issue（含正文和评论） |
| `create_issue` | 创建 Issue，自动关联当前 Session |
| `update_issue` | 更新 Issue（标题 / 正文 / 状态） |
| `create_comment` | 给 Issue 添加评论 |
| `list_comments` | 列出 Issue 的评论 |
| `list_pull_requests` | 列出 PR |
| `get_pull_request` | 获取单个 PR |
| `create_pull_request` | 创建 PR，可选关联 Issue，自动重命名 Workspace 分支 |
| `list_pr_comments` | 列出 PR 的评论 |
| `create_pr_comment` | 给 PR 添加评论 |
| `merge_pull_request` | 合并 PR |

### 自动行为

- **创建 Issue** 时自动将当前 Session 关联到新 Issue（写入 `session_links`）
- **创建 PR** 时：
  - 自动关联 Session 到 PR
  - 解析 PR body 中的 `Closes #N` 引用，关联到对应 Issue
  - 如果当前在 Workspace 分支（`ws/` 前缀），自动重命名为 PR 的 head 分支名

### Issue 上下文构建

Agent 获取 Issue 时，自动构建层级上下文：

- 递归获取父 Issue（最多 **10 层**）
- 每个祖先 Issue 附带最多 **5 条**评论
- 组装为结构化的 Markdown 上下文注入到 Agent

## Issue 管理

### 数据同步

`POST /api/repos/:repoId/issues/sync` 从 Git 平台全量拉取 Issue：

- 拉取 open + closed 状态的 Issue
- 同步字段：number, title, body, state, labels, milestone, assignees, comment_count, author, html_url
- 通过 `(repo_id, number)` 唯一索引执行 upsert

### 子任务 / Epic 树

- Issue 的 `parent_id` 字段建立父子关系
- 类型分类：
  - **Epic**：有子 Issue 的父级 Issue
  - **Task**：有父 Issue 的子级 Issue
  - **Stray**：无父子关系的独立 Issue
- 前端支持按类型筛选
- Issue 详情页展示子任务列表和进度

### 评论管理

- 前端 Issue 详情页展示评论列表（作者头像、时间、Markdown 内容）
- 内联评论输入框，支持 AI 润色：
  1. 写入草稿到临时文件（`/tmp/fourth-spark/drafts/`）
  2. 调用内置"评论助手"系统 Agent 润色
  3. 预览润色结果，确认后发布
  4. 可升级为完整对话深度处理

### 附件代理

`GET /api/repos/:repoId/issues/attachments/:path` 代理访问 Git 平台的 Issue 附件，自动注入认证头。

### 自定义标签

独立于 Git 平台的本地标签系统：

| 操作 | API |
|------|-----|
| 列出标签 | `GET /api/repos/:repoId/tags` |
| 创建标签 | `POST /api/repos/:repoId/tags` |
| 更新标签 | `PATCH /api/repos/:repoId/tags/:id` |
| 删除标签 | `DELETE /api/repos/:repoId/tags/:id` |
| 设置 Issue 标签 | `PUT /api/repos/:repoId/issues/:number/tags` |

标签字段：`name`（名称）、`color`（十六进制颜色）、`description`（说明）。

### Issue 筛选

前端 `IssuesPage` 支持多维筛选：

- **状态**：open / closed / all
- **类型**：epic / task / stray
- **标签**：按自定义标签过滤
- **里程碑**：按 Milestone 过滤
- **作者 / 负责人**：按 author_login / assignees 过滤
- **搜索**：按 Issue 编号或标题搜索

## PR 管理

### 数据同步

`POST /api/repos/:repoId/pulls/sync` 从 Git 平台全量拉取 PR：

- 同步字段：number, title, body, state, head_branch, base_branch, labels, mergeable, draft, merged_at, author, assignees, comment_count
- 自动解析 PR body 中的 Issue 引用，写入 `pr_issue_links`

### PR 操作

- **合并**：`POST /api/repos/:repoId/pulls/:number/merge`，Gitea 使用 merge 策略，GitHub/GitLab 使用平台默认策略
- **关联 Issue**：通过 `pr_issue_links` 表维护双向关联
- **评论**：通过 MCP 工具添加评论

### PR 筛选

前端 `PullRequestsPage` 支持：

- **状态**：open / merged / closed / all
- **搜索**：按 PR 编号、标题、head/base 分支名搜索
- Draft PR 标记显示

## Milestone 管理

`GET /api/repos/:repoId/milestones` 列出里程碑：

- 支持 `state` 筛选（open / closed / all）
- 字段：title, description, state, due_on, open_issues, closed_issues
- 前端用于 Issue 筛选器的 Milestone 下拉选项

## Git Host 凭证管理

设置页面管理 Git 平台凭证：

| 操作 | API |
|------|-----|
| 列出源站 | `GET /api/git-hosts` |
| 添加源站 | `POST /api/git-hosts` |
| 更新源站 | `PUT /api/git-hosts/:id` |
| 删除源站 | `DELETE /api/git-hosts/:id` |

每个源站配置：`host`（域名）、`platform`（gitea/github/gitlab）、`name`（显示名）、`token`（访问令牌）。系统根据仓库 Git URL 中的 host 自动匹配凭证。

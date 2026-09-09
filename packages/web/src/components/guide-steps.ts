export type TooltipPosition = "bottom" | "bottom-right"
export type GuideSection = "repos" | "run" | "dev" | "agents"

export interface GuideStep {
  target: string
  title: string
  description: string
  position: TooltipPosition
  section: GuideSection
  padding?: number
  route?: string
  triggerClick?: string
  mockScope?: string
  setupFn?: string
  mobileSwipeHint?: "left" | "right"
}

export const GUIDE_STEPS: GuideStep[] = [
  // ---- repos: Header + ReposPage ----
  {
    target: '[data-guide="repo-switcher"]',
    title: "切换仓库",
    description: "点击这里可以在已注册的仓库之间快速切换。每个仓库拥有独立的 Agent 运行时和会话。",
    position: "bottom",
    section: "repos",
    padding: 4,
  },
  {
    target: '[data-guide="manage-repos"]',
    title: "管理仓库",
    description: "在仓库下拉菜单底部，点击「管理仓库」可以注册新仓库、启停 Agent 进程、配置运行时类型。",
    position: "bottom-right",
    section: "repos",
    padding: 4,
    triggerClick: '[data-guide="repo-switcher"]',
  },
  {
    target: '[data-guide="repo-overflow-dropdown"]',
    title: "仓库高级操作",
    description: "每个仓库卡片的 ⋯ 菜单包含重要功能：切换运行时（OpenCode ↔ Claude Code）、开关 Worktree 任务隔离、编辑 AGENTS.md 配置。",
    position: "bottom-right",
    section: "repos",
    padding: 4,
    route: "/repos",
    triggerClick: '[data-guide="repo-overflow-btn"]',
  },
  // ---- run: RunPage ----
  {
    target: '[data-guide="run-new-input"]',
    title: "新建对话",
    description: "选择 Agent 后输入指令开始任务。按 Tab 键可快速切换 Agent，底部可选择 Variant（默认 / max / high）控制推理强度。",
    position: "bottom",
    section: "run",
    padding: 8,
    route: "run",
    mockScope: "run",
    setupFn: "clearActiveSession",
  },
  {
    target: '[data-guide="run-panel-handle"]',
    title: "运行记录面板",
    description: "拖动此手柄可收起/展开左侧运行记录列表。移动端可左右滑动打开。面板内可按「进行中 / 全部」筛选。",
    position: "bottom",
    section: "run",
    padding: 6,
    mockScope: "run",
    setupFn: "clearActiveSession",
    mobileSwipeHint: "right",
  },
  {
    target: '[data-guide="run-input-bar"]',
    title: "快捷短语与追加输入",
    description: "对话进行中可在此追加指令。上方的快捷短语按钮（如「继续」）支持一键发送，可在设置 → 通用中自定义。底部可切换模型和 Variant。",
    position: "bottom",
    section: "run",
    padding: 8,
    mockScope: "run",
    setupFn: "selectMockSession",
  },
  {
    target: '[data-guide="run-side-tabs"]',
    title: "右侧面板",
    description: "待办：Agent 的任务进度清单。输入：本次对话中你发送的所有消息。关联：Session 关联的 Issue 和 PR。子任务：Agent 派生的子 Session。",
    position: "bottom-right",
    section: "run",
    padding: 6,
    mockScope: "run",
    setupFn: "selectMockSession",
    mobileSwipeHint: "left",
  },
  // ---- dev: DevPage (Issues + PRs) ----
  {
    target: '[data-guide="issue-sync-create"]',
    title: "同步与创建",
    description: "点击 ↻ 从 Git 平台同步 Issue 和 PR 数据（首次使用必须先同步）。点击 + 可直接创建新 Issue。",
    position: "bottom",
    section: "dev",
    padding: 6,
    route: "dev/issues",
    mockScope: "dev",
  },
  {
    target: '[data-guide="issue-tag-filter"]',
    title: "标签筛选（三态）",
    description: "单击标签 → 包含筛选（高亮）；再单击 → 排除筛选（划线）；第三次单击 → 取消。支持同时选择多个标签组合筛选。",
    position: "bottom",
    section: "dev",
    padding: 4,
    mockScope: "dev",
    triggerClick: '[data-guide="issue-tag-filter"]',
  },
  {
    target: '[data-guide="issue-actions"]',
    title: "Issue 操作",
    description: "查看源站、关闭/重新打开 Issue、新建 Agent 任务处理此 Issue。右侧面板按钮可展开运行记录侧边栏。",
    position: "bottom-right",
    section: "dev",
    padding: 6,
    mockScope: "dev",
    setupFn: "selectMockIssue",
  },
  {
    target: '[data-guide="pr-actions"]',
    title: "PR 操作",
    description: "查看源站、合入 PR、解决冲突。当 PR 关联了 Issue 时，可选择合入并同时关闭关联的 Issues。",
    position: "bottom-right",
    section: "dev",
    padding: 6,
    route: "dev/pulls",
    mockScope: "dev",
    setupFn: "selectMockPr",
  },
  // ---- agents: AgentsPage + AgentDetailPage ----
  {
    target: '[data-guide="agents-header"]',
    title: "创建与导入 Agent",
    description: "点击「创建」基于 base agent + 模型 + 提示词片段组合一个自定义 Agent。点击「导入」可从 JSON 文件恢复其他实例导出的 Agent。",
    position: "bottom-right",
    section: "agents",
    padding: 6,
    route: "agents",
    mockScope: "agent",
  },
  {
    target: '[data-guide="agents-fragments"]',
    title: "提示词片段",
    description: "可复用的提示词模块，可在多个 Agent 间共享。创建 Agent 时选择片段并排序拼接顺序，构建最终的 System Prompt。",
    position: "bottom",
    section: "agents",
    padding: 6,
    mockScope: "agent",
    triggerClick: '[data-guide="agents-fragments"]',
  },
  {
    target: '[data-guide="agent-detail-actions"]',
    title: "Agent 导出与共享",
    description: "下载或复制 Agent 的 JSON 配置，可在不同 Fourth Spark 实例间导入共享。包含提示词片段和所有配置。",
    position: "bottom-right",
    section: "agents",
    padding: 4,
    route: "agents/__MOCK_AGENT__",
    mockScope: "agent",
  },
  {
    target: '[data-guide="agent-memory-section"]',
    title: "Agent 记忆",
    description: "Agent 在每次对话结束后自动提取经验记忆。每条记忆有分类标签和重要度评分（⚡）。系统定期自动整理：合并重复内容、衰减不活跃的记忆、强化反复验证的经验。",
    position: "bottom",
    section: "agents",
    padding: 6,
    mockScope: "agent",
  },
  {
    target: '[data-guide="agent-memory-version"]',
    title: "记忆版本历史",
    description: "点击版本标签可查看这条记忆的完整演化轨迹：首次提取 → 内容重写 → 多条合并 → 反复验证后强化 → 长期未用后衰减。每个版本记录了当时的内容、重要度评分和触发动作。",
    position: "bottom",
    section: "agents",
    padding: 4,
    mockScope: "agent",
  },
]

export function stepsForSection(section: GuideSection | null): GuideStep[] {
  if (!section) return GUIDE_STEPS
  return GUIDE_STEPS.filter((s) => s.section === section)
}

export function sectionFromPath(pathname: string): GuideSection | null {
  if (pathname === "/repos" || pathname === "/settings") return "repos"
  const sub = pathname.replace(/^\/[^/]+\//, "")
  if (sub.startsWith("run")) return "run"
  if (sub.startsWith("dev")) return "dev"
  if (sub.startsWith("agents")) return "agents"
  return null
}

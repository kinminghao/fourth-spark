export type TooltipPosition = "bottom" | "bottom-right"

export interface GuideStep {
  /** CSS selector for the target element (uses data-guide attribute) */
  target: string
  /** Step title */
  title: string
  /** Step description */
  description: string
  /** Tooltip position relative to target */
  position: TooltipPosition
  /** Padding around the highlighted element (px) */
  padding?: number
  /** Navigate to this route before showing the step */
  route?: string
  /** Click this selector before measuring target (to open menus/dropdowns) */
  triggerClick?: string
  /** Mock data scope — inject mock data when entering steps with this scope */
  mockScope?: string
  /** Called after route navigation + mock injection to set up UI state (e.g. select an issue) */
  setupFn?: string
}

export const GUIDE_STEPS: GuideStep[] = [
  // ---- Header: repo switcher ----
  {
    target: '[data-guide="repo-switcher"]',
    title: "切换仓库",
    description: "点击这里可以在已注册的仓库之间快速切换。每个仓库拥有独立的 Agent 运行时和会话。",
    position: "bottom",
    padding: 4,
  },
  {
    target: '[data-guide="manage-repos"]',
    title: "管理仓库",
    description: "在仓库下拉菜单底部，点击「管理仓库」可以注册新仓库、启停 Agent 进程、配置运行时类型。",
    position: "bottom-right",
    padding: 4,
    triggerClick: '[data-guide="repo-switcher"]',
  },
  // ---- ReposPage: overflow menu ----
  {
    target: '[data-guide="repo-overflow-dropdown"]',
    title: "仓库高级操作",
    description: "每个仓库卡片的 ⋯ 菜单包含重要功能：切换运行时（OpenCode ↔ Claude Code）、开关 Worktree 任务隔离、编辑 AGENTS.md 配置。",
    position: "bottom-right",
    padding: 4,
    route: "/repos",
    triggerClick: '[data-guide="repo-overflow-btn"]',
  },
  // ---- DevPage (Issues): sync + create ----
  {
    target: '[data-guide="issue-sync-create"]',
    title: "同步与创建",
    description: "点击 ↻ 从 Git 平台同步 Issue 和 PR 数据（首次使用必须先同步）。点击 + 可直接创建新 Issue。",
    position: "bottom",
    padding: 6,
    route: "dev/issues",
    mockScope: "dev",
  },
  // ---- DevPage (Issues): tag filter ----
  {
    target: '[data-guide="issue-tag-filter"]',
    title: "标签筛选（三态）",
    description: "单击标签 → 包含筛选（高亮）；再单击 → 排除筛选（划线）；第三次单击 → 取消。支持同时选择多个标签组合筛选。",
    position: "bottom",
    padding: 4,
    mockScope: "dev",
    triggerClick: '[data-guide="issue-tag-filter"]',
  },
  // ---- DevPage (Issues): detail action bar ----
  {
    target: '[data-guide="issue-actions"]',
    title: "Issue 操作",
    description: "查看源站、关闭/重新打开 Issue、新建 Agent 任务处理此 Issue。右侧面板按钮可展开运行记录侧边栏。",
    position: "bottom-right",
    padding: 6,
    mockScope: "dev",
    setupFn: "selectMockIssue",
  },
  // ---- DevPage (PRs): detail action bar ----
  {
    target: '[data-guide="pr-actions"]',
    title: "PR 操作",
    description: "查看源站、合入 PR、解决冲突。当 PR 关联了 Issue 时，可选择合入并同时关闭关联的 Issues。",
    position: "bottom-right",
    padding: 6,
    route: "dev/pulls",
    mockScope: "dev",
    setupFn: "selectMockPr",
  },
]

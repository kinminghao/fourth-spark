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
}

export const GUIDE_STEPS: GuideStep[] = [
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
  },
]

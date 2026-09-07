import type { Issue, PersistentPullRequest, Tag, CustomAgent, AgentMemory } from "../lib/api-client"
import { useIssueStore } from "../stores/issue-store"
import { usePrStore } from "../stores/pr-store"
import { useCustomAgentStore } from "../stores/custom-agent-store"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ID = "__guide__"
const NOW = Date.now()
const DAY = 86_400_000

export const GUIDE_AGENT_PREFIX = "guide-agent-"
const MOCK_AGENT_ID = `${GUIDE_AGENT_PREFIX}1`

// ---------------------------------------------------------------------------
// Dev mock data — Issues / PRs / Tags
// ---------------------------------------------------------------------------

const MOCK_ISSUES: Issue[] = [
  {
    id: "guide-issue-1",
    repoId: REPO_ID,
    number: 42,
    title: "添加用户认证模块",
    body: "实现 JWT 认证，包括登录、注册和 token 刷新。",
    state: "open",
    labels: [{ id: 1, name: "feature", color: "0075ca" }],
    htmlUrl: "#",
    authorLogin: "demo-user",
    createdAt: NOW - DAY,
    updatedAt: NOW - 3_600_000,
  },
  {
    id: "guide-issue-2",
    repoId: REPO_ID,
    number: 41,
    title: "修复登录页样式错位",
    body: "移动端登录表单在小屏幕下溢出。",
    state: "closed",
    labels: [{ id: 2, name: "bug", color: "d73a4a" }],
    htmlUrl: "#",
    authorLogin: "demo-user",
    createdAt: NOW - 2 * DAY,
    updatedAt: NOW - DAY,
  },
]

const MOCK_PRS: PersistentPullRequest[] = [
  {
    id: "guide-pr-1",
    repoId: REPO_ID,
    number: 10,
    title: "feat: add auth module",
    body: "Implements JWT authentication.",
    state: "open",
    headBranch: "feat/auth",
    baseBranch: "main",
    labels: [{ id: 1, name: "feature", color: "0075ca" }],
    htmlUrl: "#",
    authorLogin: "demo-user",
    mergeable: "true",
    draft: 0,
    commentCount: 0,
    additions: 320,
    deletions: 12,
    changedFilesCount: 8,
    createdAt: NOW - DAY,
    updatedAt: NOW - 3_600_000,
    mergedAt: null,
  },
  {
    id: "guide-pr-2",
    repoId: REPO_ID,
    number: 9,
    title: "fix: login page CSS overflow",
    state: "merged",
    headBranch: "fix/login-css",
    baseBranch: "main",
    draft: 0,
    commentCount: 1,
    additions: 15,
    deletions: 3,
    changedFilesCount: 2,
    createdAt: NOW - 2 * DAY,
    updatedAt: NOW - DAY,
    mergedAt: NOW - DAY,
  },
]

const MOCK_TAGS: Tag[] = [
  { id: "guide-tag-1", repoId: REPO_ID, name: "bug", color: "d73a4a" },
  { id: "guide-tag-2", repoId: REPO_ID, name: "feature", color: "0075ca" },
  { id: "guide-tag-3", repoId: REPO_ID, name: "priority", color: "e4e669" },
]

// ---------------------------------------------------------------------------
// Agent mock data — CustomAgent + Memories with version history
// ---------------------------------------------------------------------------

const MOCK_AGENT: CustomAgent = {
  id: MOCK_AGENT_ID,
  name: "示例 Agent",
  description: "用于功能引导的演示 Agent",
  baseAgent: "Sisyphus - ultraworker",
  model: null,
  variant: null,
  systemPrompt: "",
  systemPromptPosition: 0,
  isSystem: 0,
  memoryModel: null,
  fragments: [],
  repoId: null,
  sortOrder: 999,
  createdAt: NOW - 7 * DAY,
  updatedAt: NOW - DAY,
}

/** Exported for MemorySection to detect and use when agentId is a mock */
export const MOCK_MEMORIES: AgentMemory[] = [
  {
    id: "guide-mem-1",
    customAgentId: MOCK_AGENT_ID,
    sessionId: "guide-session-1",
    mergedFrom: null,
    content: "用户偏好 TypeScript strict 模式，所有新文件必须启用 strictNullChecks",
    category: "编码规范",
    importance: 0.92,
    supersededBy: null,
    history: [
      { content: "用户使用 TypeScript", importance: 0.5, category: "编码规范", action: "create", ts: NOW - 7 * DAY },
      { content: "用户偏好 TypeScript strict 模式", importance: 0.75, category: "编码规范", action: "update", ts: NOW - 3 * DAY },
      { content: "用户偏好 TypeScript strict 模式，所有新文件必须启用 strictNullChecks", importance: 0.92, category: "编码规范", action: "reinforce", ts: NOW - DAY },
    ],
    createdAt: NOW - 7 * DAY,
    updatedAt: NOW - DAY,
  },
  {
    id: "guide-mem-2",
    customAgentId: MOCK_AGENT_ID,
    sessionId: "guide-session-2",
    mergedFrom: ["guide-mem-old-1", "guide-mem-old-2"],
    content: "项目使用 Tailwind CSS 4 + zustand 状态管理，组件优先使用函数式写法",
    category: "技术栈",
    importance: 0.85,
    supersededBy: null,
    history: [
      { content: "项目使用 Tailwind CSS", importance: 0.6, category: "技术栈", action: "create", ts: NOW - 5 * DAY },
      { content: "项目使用 Tailwind CSS 4 + zustand 状态管理，组件优先使用函数式写法", importance: 0.85, category: "技术栈", action: "merge", ts: NOW - 2 * DAY },
    ],
    createdAt: NOW - 5 * DAY,
    updatedAt: NOW - 2 * DAY,
  },
  {
    id: "guide-mem-3",
    customAgentId: MOCK_AGENT_ID,
    sessionId: "guide-session-1",
    mergedFrom: null,
    content: "Git 提交信息使用 conventional commits 格式",
    category: "工作流",
    importance: 0.45,
    supersededBy: null,
    history: [
      { content: "Git 提交信息使用 conventional commits 格式", importance: 0.7, category: "工作流", action: "create", ts: NOW - 10 * DAY },
      { content: "Git 提交信息使用 conventional commits 格式", importance: 0.45, category: "工作流", action: "decay", ts: NOW - 4 * DAY },
    ],
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW - 4 * DAY,
  },
]

// ---------------------------------------------------------------------------
// Inject / Restore — scope-aware mock data lifecycle
// ---------------------------------------------------------------------------

interface Snapshot {
  issues: Issue[]
  tags: Tag[]
  issueLoaded: boolean
  pulls: PersistentPullRequest[]
  prLoaded: boolean
  agents: CustomAgent[]
}

let saved: Snapshot | null = null

export function injectMockData(scope: string) {
  if (!saved) {
    // First time: snapshot all stores
    const issueState = useIssueStore.getState()
    const prState = usePrStore.getState()
    const agentState = useCustomAgentStore.getState()
    saved = {
      issues: issueState.issues,
      tags: issueState.tags,
      issueLoaded: issueState.loaded,
      pulls: prState.pulls,
      prLoaded: prState.loaded,
      agents: agentState.agents,
    }
  }

  if (scope === "dev") {
    useIssueStore.setState({ issues: MOCK_ISSUES, tags: MOCK_TAGS, loaded: true })
    usePrStore.setState({ pulls: MOCK_PRS, loaded: true })
    // Restore agent store if it was mocked
    useCustomAgentStore.setState({ agents: saved.agents })
  } else if (scope === "agent") {
    // Restore issue/pr stores if they were mocked
    useIssueStore.setState({ issues: saved.issues, tags: saved.tags, loaded: saved.issueLoaded, viewingIssueId: null, viewingTreeRootId: null })
    usePrStore.setState({ pulls: saved.pulls, loaded: saved.prLoaded, viewingPrId: null })
    // Inject mock agent (append to real agents)
    const hasGuide = saved.agents.some((a) => a.id === MOCK_AGENT_ID)
    useCustomAgentStore.setState({ agents: hasGuide ? saved.agents : [...saved.agents, MOCK_AGENT] })
  }
}

export function restoreMockData() {
  if (!saved) return
  useIssueStore.setState({ issues: saved.issues, tags: saved.tags, loaded: saved.issueLoaded, viewingIssueId: null, viewingTreeRootId: null })
  usePrStore.setState({ pulls: saved.pulls, loaded: saved.prLoaded, viewingPrId: null })
  useCustomAgentStore.setState({ agents: saved.agents })
  saved = null
}

/** Select a mock issue so the detail panel renders */
export function selectMockIssue() {
  useIssueStore.setState({ viewingIssueId: MOCK_ISSUES[0].id })
}

/** Select a mock PR so the detail panel renders */
export function selectMockPr() {
  usePrStore.setState({ viewingPrId: MOCK_PRS[0].id })
}

/** Navigate to mock agent detail page (returns the agent ID for route building) */
export function getMockAgentId(): string {
  return MOCK_AGENT_ID
}

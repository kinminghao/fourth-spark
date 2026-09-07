import type { Issue, PersistentPullRequest, Tag } from "../lib/api-client"
import { useIssueStore } from "../stores/issue-store"
import { usePrStore } from "../stores/pr-store"

// ---------------------------------------------------------------------------
// Mock data — minimal set to render Issue/PR list + detail panels
// ---------------------------------------------------------------------------

const REPO_ID = "__guide__"
const NOW = Date.now()

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
    createdAt: NOW - 86_400_000,
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
    createdAt: NOW - 172_800_000,
    updatedAt: NOW - 86_400_000,
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
    createdAt: NOW - 86_400_000,
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
    createdAt: NOW - 172_800_000,
    updatedAt: NOW - 86_400_000,
    mergedAt: NOW - 86_400_000,
  },
]

const MOCK_TAGS: Tag[] = [
  { id: "guide-tag-1", repoId: REPO_ID, name: "bug", color: "d73a4a" },
  { id: "guide-tag-2", repoId: REPO_ID, name: "feature", color: "0075ca" },
  { id: "guide-tag-3", repoId: REPO_ID, name: "priority", color: "e4e669" },
]

// ---------------------------------------------------------------------------
// Inject / Restore — saves real store state, swaps in mock data
// ---------------------------------------------------------------------------

interface Snapshot {
  issues: Issue[]
  tags: Tag[]
  loaded: boolean
  pulls: PersistentPullRequest[]
  prLoaded: boolean
}

let saved: Snapshot | null = null

export function injectMockData() {
  if (saved) return // already injected

  const issueState = useIssueStore.getState()
  const prState = usePrStore.getState()

  saved = {
    issues: issueState.issues,
    tags: issueState.tags,
    loaded: issueState.loaded,
    pulls: prState.pulls,
    prLoaded: prState.loaded,
  }

  useIssueStore.setState({ issues: MOCK_ISSUES, tags: MOCK_TAGS, loaded: true })
  usePrStore.setState({ pulls: MOCK_PRS, loaded: true })
}

export function restoreMockData() {
  if (!saved) return

  useIssueStore.setState({
    issues: saved.issues,
    tags: saved.tags,
    loaded: saved.loaded,
    viewingIssueId: null,
    viewingTreeRootId: null,
  })
  usePrStore.setState({
    pulls: saved.pulls,
    loaded: saved.prLoaded,
    viewingPrId: null,
  })

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

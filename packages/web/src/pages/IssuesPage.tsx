import { useEffect, useState, type KeyboardEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  CircleDot,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Network,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Search,
  Wrench,
  X,
  XCircle,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"
import clsx from "clsx"
import { ApiError, type Issue, type IssueComment, type PullRequest, type Session, listIssueComments, listIssuePullRequests, mergePullRequest } from "../lib/api-client"
import { useIssueStore } from "../stores/issue-store"
import { useRepoStore } from "../stores/repo-store"
import { useSessionStore } from "../stores/session-store"
import { useToastStore } from "../stores/toast-store"
import { useSwipeDrawer } from "../hooks/use-swipe-drawer"
import { SwipeDrawer } from "../components/SwipeDrawer"

type StateFilter = "open" | "closed" | "all"
type TypeFilter = "all" | "epic" | "task" | "stray"

const STATE_FILTERS: { key: StateFilter; label: string }[] = [
  { key: "open", label: "开放" },
  { key: "closed", label: "已关闭" },
  { key: "all", label: "全部" },
]



/* ------------------------------------------------------------------ */
/*  Create-issue inline form                                          */
/* ------------------------------------------------------------------ */

function CreateForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const createIssue = useIssueStore((s) => s.createIssue)

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    await createIssue(title.trim(), body.trim() || undefined)
    setBusy(false)
    onDone()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="border-b border-line px-3 py-3">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Issue 标题"
        autoFocus
        className="w-full rounded-md border border-line bg-base px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-6 focus:border-fg-5 focus:outline-none"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="描述（可选）  ⌘⏎ 创建"
        rows={3}
        className="mt-2 w-full resize-none rounded-md border border-line bg-base px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-6 focus:border-fg-5 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-2.5 py-1 text-xs text-fg-4 transition-colors hover:text-fg-2"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!title.trim() || busy}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          创建
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Issue row in the list                                             */
/* ------------------------------------------------------------------ */

function IssueRow({
  issue,
  sessionCount,
  isActive,
  isEpic,
  onSelect,
}: {
  issue: Issue
  sessionCount: number
  isActive: boolean
  isEpic?: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={clsx(
          "group flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left transition-colors",
          isActive
            ? "border-l-2 border-blue-500 bg-elevated/80"
            : "border-l-2 border-transparent hover:bg-elevated/50",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={clsx(
                "shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-medium",
                issue.state === "open"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-purple-500/15 text-purple-400",
              )}
            >
              #{issue.number}
            </span>
            {isEpic && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide bg-amber-400/12 text-amber-400">
                EPIC
              </span>
            )}
            <span className="min-w-0 text-sm font-medium text-fg-2">
              {issue.title}
            </span>
          </div>

          {issue.labels && issue.labels.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {issue.labels.map((l) => (
                <span
                  key={l.id}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: `#${l.color}20`,
                    color: `#${l.color}`,
                  }}
                >
                  {l.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {sessionCount > 0 && (
          <span className="mt-0.5 shrink-0 rounded-full bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">
            {sessionCount}
          </span>
        )}
      </button>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/*  Detail panel (right side)                                         */
/* ------------------------------------------------------------------ */

function IssueDetail({ issue, onBack, onToggleSidebar }: { issue: Issue; onBack?: () => void; onToggleSidebar?: () => void }) {
  const navigate = useNavigate()
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const [comments, setComments] = useState<IssueComment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [linkedPRs, setLinkedPRs] = useState<PullRequest[]>([])
  const [activePRIdx, setActivePRIdx] = useState(0)
  const [merging, setMerging] = useState(false)
  const [togglingState, setTogglingState] = useState(false)
  const [detailTab, setDetailTab] = useState<"issue" | "pr">("issue")
  const updateIssueState = useIssueStore((s) => s.updateIssueState)

  useEffect(() => {
    if (!activeRepoId) return
    setLoadingComments(true)
    listIssueComments(activeRepoId, issue.number)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setLoadingComments(false))
  }, [activeRepoId, issue.number])

  useEffect(() => {
    if (!activeRepoId) return
    listIssuePullRequests(activeRepoId, issue.number)
      .then(setLinkedPRs)
      .catch(() => setLinkedPRs([]))
  }, [activeRepoId, issue.number])

  useEffect(() => {
    setDetailTab("issue")
    setActivePRIdx(0)
  }, [issue.id])

  const pr = linkedPRs[activePRIdx] ?? linkedPRs[0]

  const handleMerge = async (closeIssue: boolean) => {
    if (merging || !activeRepoId || !pr) return
    setMerging(true)
    try {
      await mergePullRequest(activeRepoId, issue.number, pr.number, closeIssue)
      if (closeIssue) await updateIssueState(issue.number, "closed")
      const refreshed = await listIssuePullRequests(activeRepoId, issue.number)
      setLinkedPRs(refreshed)
      if (activePRIdx >= refreshed.length) setActivePRIdx(Math.max(0, refreshed.length - 1))
      useToastStore.getState().addToast(`PR #${pr.number} 合入成功`, "success")
    } catch (err) {
      let msg = "合入失败"
      if (err instanceof ApiError) {
        try {
          const parsed = JSON.parse(err.message)
          msg = parsed.error ?? msg
        } catch {
          msg = err.message
        }
      }
      useToastStore.getState().addToast(msg, "error")
    } finally {
      setMerging(false)
    }
  }

  const handleResolveConflict = () => {
    if (!pr) return
    const draft = `请解决 PR #${pr.number} 的合并冲突: ${pr.title}`
    useIssueStore.getState().setSelectedIssue(issue.id)
    useIssueStore.getState().setPendingDraft(draft)
    useIssueStore.getState().setPreviewIssue(null)
    useSessionStore.setState({ activeSessionId: null })
    navigate("/run")
  }

  const handleStart = () => {
    useIssueStore.getState().setSelectedIssue(issue.id)
    useIssueStore.getState().setPreviewIssue(null)
    useSessionStore.setState({ activeSessionId: null })
    navigate("/run")
  }

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex flex-col gap-2 border-b border-line px-4 py-3 md:flex-row md:items-center md:gap-3 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回列表"
            className="-ml-1 shrink-0 rounded-md p-1.5 text-fg-3 transition-colors hover:bg-elevated hover:text-fg md:hidden"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                  issue.state === "open"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-purple-500/15 text-purple-400",
                )}
              >
                #{issue.number} {issue.state}
              </span>
              {issue.labels?.map((l) => (
                <span
                  key={l.id}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: `#${l.color}20`,
                    color: `#${l.color}`,
                  }}
                >
                  {l.name}
                </span>
              ))}
            </div>
            <h2 className="mt-1 text-base font-semibold text-fg">
              {issue.title}
            </h2>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {issue.htmlUrl && (
            <a
              href={issue.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 font-mono text-xs text-fg-3 transition-colors hover:border-fg-5 hover:text-fg"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              源站
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              useIssueStore.getState().enterMatchMode(issue.id)
              useSessionStore.setState({ activeSessionId: null })
              navigate("/run")
            }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-fg-3 transition-colors hover:border-blue-500/50 hover:text-blue-400"
          >
            <GitBranch className="h-3.5 w-3.5" />
            匹配子任务
          </button>
          <button
            type="button"
            disabled={togglingState}
            onClick={async () => {
              setTogglingState(true)
              await updateIssueState(issue.number, issue.state === "open" ? "closed" : "open")
              setTogglingState(false)
            }}
            className={clsx(
              "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:opacity-40",
              issue.state === "open"
                ? "border-red-500/30 text-red-400 hover:border-red-500/60 hover:bg-red-500/10"
                : "border-emerald-500/30 text-emerald-400 hover:border-emerald-500/60 hover:bg-emerald-500/10",
            )}
          >
            {issue.state === "open" ? (
              <>
                <XCircle className="h-3.5 w-3.5" />
                关闭
              </>
            ) : (
              <>
                <CircleDot className="h-3.5 w-3.5" />
                重新打开
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleStart}
            className="flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-500"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            开始处理
          </button>
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              title="面板"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-2"
            >
              <PanelRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Tab bar: Issue / PR */}
      {linkedPRs.length > 0 && (
        <div className="flex shrink-0 items-center border-b border-line bg-surface">
          <button
            type="button"
            onClick={() => setDetailTab("issue")}
            className={clsx(
              "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors",
              detailTab === "issue"
                ? "border-blue-500 text-fg"
                : "border-transparent text-fg-4 hover:text-fg-2",
            )}
          >
            <CircleDot className="h-3.5 w-3.5" />
            Issue
          </button>
          <button
            type="button"
            onClick={() => setDetailTab("pr")}
            className={clsx(
              "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors",
              detailTab === "pr"
                ? "border-blue-500 text-fg"
                : "border-transparent text-fg-4 hover:text-fg-2",
            )}
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            PR
            <span className={clsx(
              "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
              detailTab === "pr" ? "bg-blue-500/10 text-blue-500" : "bg-elevated text-fg-5",
            )}>
              {linkedPRs.length}
            </span>
            {linkedPRs.some((p) => p.mergeable === false) && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-400">
                <AlertTriangle className="inline h-3 w-3 -mt-px" /> Conflict
              </span>
            )}
          </button>
        </div>
      )}

      {/* Tab content */}
      {(detailTab === "issue" || linkedPRs.length === 0) ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
            {issue.body ? (
              <div className="markdown-body leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {issue.body}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="py-10 text-center font-mono text-xs text-fg-5">
                该 Issue 没有描述内容
              </p>
            )}

            {loadingComments ? (
              <p className="mt-8 text-center font-mono text-xs text-fg-6">加载评论…</p>
            ) : comments.length > 0 && (
              <div className="mt-8 border-t border-line pt-6">
                <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-fg-4">
                  评论 ({comments.length})
                </h3>
                <div className="space-y-4">
                  {comments.map((c) => (
                    <div key={c.id} className="rounded-lg border border-line bg-elevated/40 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <img
                          src={c.user.avatar_url}
                          alt={c.user.login}
                          className="h-5 w-5 rounded-full"
                        />
                        <span className="text-xs font-semibold text-fg-2">{c.user.login}</span>
                        <span className="text-[10px] text-fg-6">{fmtDate(c.created_at)}</span>
                      </div>
                      <div className="markdown-body mt-2 text-sm leading-relaxed text-fg-3">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                          {c.body}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* PR sub-tabs (multiple PRs) + action buttons */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-0">
            {linkedPRs.length > 1 && linkedPRs.map((p, idx) => (
              <button
                key={p.number}
                type="button"
                onClick={() => setActivePRIdx(idx)}
                className={clsx(
                  "flex items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-xs font-medium transition-colors",
                  idx === activePRIdx
                    ? "border-blue-500 text-fg"
                    : "border-transparent text-fg-4 hover:text-fg-2",
                )}
              >
                <span className="font-mono text-[10px]">#{p.number}</span>
                <span className="max-w-[140px] truncate">{p.title}</span>
              </button>
            ))}
            <div className={clsx("flex items-center gap-2", linkedPRs.length > 1 && "ml-auto")}>
              {pr?.html_url && (
                <a
                  href={pr.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-md border border-line px-2 py-1.5 font-mono text-[11px] text-fg-3 transition-colors hover:border-fg-5 hover:text-fg"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span className="hidden sm:inline">查看</span>
                </a>
              )}
              {pr?.mergeable === false && (
                <button
                  type="button"
                  onClick={handleResolveConflict}
                  className="flex items-center gap-1.5 rounded-md border border-amber-500/30 px-2.5 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">解冲突</span>
                </button>
              )}
              <button
                type="button"
                disabled={merging || pr?.mergeable === false}
                onClick={() => void handleMerge(false)}
                className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 px-2.5 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/10 disabled:opacity-40"
              >
                <GitMerge className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">合入</span>
              </button>
              <button
                type="button"
                disabled={merging || pr?.mergeable === false}
                onClick={() => void handleMerge(true)}
                className="flex items-center gap-1.5 rounded-md border border-blue-500/30 px-2.5 py-1.5 text-xs font-medium text-blue-400 transition-colors hover:border-blue-500/60 hover:bg-blue-500/10 disabled:opacity-40"
              >
                <GitMerge className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">合入并关闭</span>
              </button>
            </div>
          </div>

          {/* PR body */}
          {pr && (
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={clsx(
                      "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                      pr.state === "open"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-purple-500/15 text-purple-400",
                    )}
                  >
                    #{pr.number} {pr.state}
                  </span>
                  {pr.mergeable === false && (
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-400">
                      Conflict
                    </span>
                  )}
                  <span className="text-sm font-semibold text-fg">{pr.title}</span>
                </div>
                {pr.body ? (
                  <div className="markdown-body leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                      {pr.body}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="py-6 text-center font-mono text-xs text-fg-5">
                    该 PR 没有描述内容
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Tree sidebar for epics                                            */
/* ------------------------------------------------------------------ */

function TreeNode({
  issue,
  childrenMap,
  currentId,
  onSelect,
  depth,
}: {
  issue: Issue
  childrenMap: Map<string, Issue[]>
  currentId: string | null
  onSelect: (id: string) => void
  depth: number
}) {
  const children = childrenMap.get(issue.id) ?? []
  const isCurrent = issue.id === currentId

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(issue.id)}
        className={clsx(
          "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
          isCurrent
            ? "bg-blue-500/10 text-blue-400"
            : "text-fg-4 hover:bg-elevated/60 hover:text-fg-2",
        )}
        style={{ paddingLeft: `${depth * 18 + 8}px` }}
      >
        <span
          className={clsx(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            issue.state === "open" ? "bg-emerald-400" : "bg-purple-400",
          )}
        />
        <span className="shrink-0 font-mono text-[10px] text-fg-6">
          #{issue.number}
        </span>
        <span className="min-w-0 truncate">{issue.title}</span>
      </button>

      {children.length > 0 && (
        <div className="relative">
          <div
            className="absolute top-0 bottom-3 w-px bg-line"
            style={{ left: `${depth * 18 + 16}px` }}
          />
          {children.map((child) => (
            <TreeNode
              key={child.id}
              issue={child}
              childrenMap={childrenMap}
              currentId={currentId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function countDescendants(
  rootId: string,
  childrenMap: Map<string, Issue[]>,
): { total: number; closed: number } {
  let total = 0
  let closed = 0
  const stack = [...(childrenMap.get(rootId) ?? [])]
  for (let i = 0; i < stack.length; i++) {
    const c = stack[i]
    total++
    if (c.state === "closed") closed++
    const grandchildren = childrenMap.get(c.id)
    if (grandchildren) stack.push(...grandchildren)
  }
  return { total, closed }
}

function formatSessionTime(session: Session): string {
  const raw = typeof session.time?.created === "number"
    ? session.time.created
    : session.createdAt
      ? Date.parse(session.createdAt)
      : 0
  if (!raw || Number.isNaN(raw)) return ""
  const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw
  const date = new Date(ms)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function SidebarSessionItem({ session, onSelect }: { session: Session; onSelect: () => void }) {
  const when = formatSessionTime(session)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="block w-full rounded-md border-l-2 border-transparent px-2.5 py-2 text-left transition-colors hover:bg-elevated/50"
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate font-mono text-xs text-fg-3">{session.agent?.trim() || "默认"}</span>
          {when && <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-fg-5">{when}</span>}
        </div>
        <div className="mt-0.5 truncate text-sm text-fg-2">{session.title?.trim() || "未命名运行"}</div>
      </button>
    </li>
  )
}

function SidebarSessionList({
  sessions,
  onSelect,
}: {
  sessions: Session[]
  onSelect: (sessionId: string) => void
}) {
  const issues = useIssueStore((s) => s.issues)
  const issueMap = new Map(issues.map((i) => [i.id, i]))

  const grouped = new Map<string, Session[]>()
  const unlinked: Session[] = []
  for (const s of sessions) {
    if (s.issueId && issueMap.has(s.issueId)) {
      const list = grouped.get(s.issueId) ?? []
      list.push(s)
      grouped.set(s.issueId, list)
    } else {
      unlinked.push(s)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-3">
        <Activity className="h-3.5 w-3.5 text-fg-5" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-4">
          运行记录
        </span>
        <span className="ml-auto rounded-full bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">
          {sessions.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sessions.length === 0 ? (
          <p className="px-2 py-4 text-center font-mono text-[10px] text-fg-6">暂无运行记录</p>
        ) : (
          <div className="space-y-3">
            {[...grouped.entries()].map(([gid, list]) => {
              const issue = issueMap.get(gid)!
              return (
                <div key={gid}>
                  <div className="mb-1 flex items-center gap-1.5 px-1">
                    <span className={clsx(
                      "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium",
                      issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
                    )}>
                      #{issue.number}
                    </span>
                    <span className="min-w-0 truncate text-xs font-medium text-fg-3">{issue.title}</span>
                  </div>
                  <ul className="space-y-0.5">
                    {list.map((s) => (
                      <SidebarSessionItem key={s.id} session={s} onSelect={() => onSelect(s.id)} />
                    ))}
                  </ul>
                </div>
              )
            })}
            {unlinked.length > 0 && (
              <div>
                {grouped.size > 0 && (
                  <div className="mb-1 px-1">
                    <span className="text-xs font-medium text-fg-5">未关联 Issue</span>
                  </div>
                )}
                <ul className="space-y-0.5">
                  {unlinked.map((s) => (
                    <SidebarSessionItem key={s.id} session={s} onSelect={() => onSelect(s.id)} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function IssueTreeSidebar({
  rootIssue,
  childrenMap,
  currentId,
  onSelect,
  sessions,
  onSessionSelect,
}: {
  rootIssue: Issue
  childrenMap: Map<string, Issue[]>
  currentId: string | null
  onSelect: (id: string) => void
  sessions: Session[]
  onSessionSelect: (sessionId: string) => void
}) {
  const { total, closed } = countDescendants(rootIssue.id, childrenMap)
  const pct = total === 0 ? 0 : Math.round((closed / total) * 100)

  return (
    <div className="flex w-full flex-col">
      {/* Top half: subtask tree */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 border-b border-line px-3 py-3">
          <Network className="h-3.5 w-3.5 text-fg-5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-4">
            子任务树
          </span>
        </div>

        {total > 0 && (
          <div className="border-b border-line px-3 py-2">
            <div className="h-1 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-blue-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1 font-mono text-[10px] text-fg-6">
              {closed} / {total} completed
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-2">
          <TreeNode
            issue={rootIssue}
            childrenMap={childrenMap}
            currentId={currentId}
            onSelect={onSelect}
            depth={0}
          />
        </div>
      </div>

      {/* Bottom half: sessions */}
      <SidebarSessionList sessions={sessions} onSelect={onSessionSelect} />
    </div>
  )
}

function IssueSessionSidebar({
  sessions,
  onSessionSelect,
}: {
  sessions: Session[]
  onSessionSelect: (sessionId: string) => void
}) {
  return (
    <div className="flex w-full flex-col">
      <SidebarSessionList sessions={sessions} onSelect={onSessionSelect} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export function IssuesPage() {
  const [stateFilter, setStateFilter] = useState<StateFilter>("open")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("epic")
  const [creating, setCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [treeRootId, setTreeRootId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [listDrawerOpen, setListDrawerOpen] = useState(false)

  const [searchParams, setSearchParams] = useSearchParams()

  const issues = useIssueStore((s) => s.issues)
  const syncing = useIssueStore((s) => s.syncing)
  const syncIssues = useIssueStore((s) => s.syncIssues)
  const tags = useIssueStore((s) => s.tags)
  const selectedTagIds = useIssueStore((s) => s.selectedTagIds)
  const toggleTagFilter = useIssueStore((s) => s.toggleTagFilter)
  const clearTagFilter = useIssueStore((s) => s.clearTagFilter)
  const loadTags = useIssueStore((s) => s.loadTags)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const sessions = useSessionStore((s) => s.sessions)

  /* Pick up ?issueId= from URL (e.g. navigated from session header) */
  useEffect(() => {
    const paramId = searchParams.get("issueId")
    if (paramId && issues.some((i) => i.id === paramId)) {
      setSelectedId(paramId)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams, issues])

  useEffect(() => {
    if (activeRepoId) void loadTags()
  }, [activeRepoId, loadTags])

  const sessionCounts = new Map<string, number>()
  for (const s of sessions) {
    if (s.issueId && !s.parentID) {
      sessionCounts.set(s.issueId, (sessionCounts.get(s.issueId) ?? 0) + 1)
    }
  }

  const childIssueIds = new Set(issues.filter((i) => i.parentId).map((i) => i.parentId!))

  const childrenMap = new Map<string, Issue[]>()
  for (const i of issues) {
    if (i.parentId) {
      const siblings = childrenMap.get(i.parentId)
      if (siblings) siblings.push(i)
      else childrenMap.set(i.parentId, [i])
    }
  }

  function issueType(i: { parentId?: string; id: string }): "epic" | "task" | "stray" {
    if (i.parentId) return "task"
    if (childIssueIds.has(i.id)) return "epic"
    return "stray"
  }

  const afterState = stateFilter === "all" ? issues : issues.filter((i) => i.state === stateFilter)
  const afterType = typeFilter === "all" ? afterState : afterState.filter((i) => issueType(i) === typeFilter)
  const afterTags = selectedTagIds.size === 0
    ? afterType
    : afterType.filter((i) => {
        if (!i.labels || i.labels.length === 0) return false
        const issueTagNames = new Set(i.labels.map((l) => l.name))
        const selectedNames = tags.filter((t) => selectedTagIds.has(t.id)).map((t) => t.name)
        return selectedNames.every((n) => issueTagNames.has(n))
      })
  const sq = searchQuery.trim().toLowerCase()
  const filtered = !sq
    ? afterTags
    : afterTags.filter((i) => `#${i.number} ${i.title}`.toLowerCase().includes(sq))

  const openCount = issues.filter((i) => i.state === "open").length
  const closedCount = issues.filter((i) => i.state === "closed").length
  const epicCount = afterState.filter((i) => issueType(i) === "epic").length
  const taskCount = afterState.filter((i) => issueType(i) === "task").length
  const strayCount = afterState.filter((i) => issueType(i) === "stray").length

  const selectedIssue = issues.find((i) => i.id === selectedId) ?? null
  const navigate = useNavigate()

  const selectedIssueIds = new Set<string>()
  if (selectedId) {
    selectedIssueIds.add(selectedId)
    if (treeRootId) {
      selectedIssueIds.add(treeRootId)
      const stack = [...(childrenMap.get(treeRootId) ?? [])]
      for (let idx = 0; idx < stack.length; idx++) {
        selectedIssueIds.add(stack[idx].id)
        const grandchildren = childrenMap.get(stack[idx].id)
        if (grandchildren) stack.push(...grandchildren)
      }
    }
  }
  const selectedIssueSessions = sessions.filter(
    (s) => s.issueId && selectedIssueIds.has(s.issueId) && !s.parentID,
  )

  const handleSessionSelect = (sessionId: string) => {
    useSessionStore.setState({ activeSessionId: sessionId })
    navigate("/run")
  }

  const swipeHandlers = useSwipeDrawer({
    onSwipeRight: () => setListDrawerOpen(true),
    onSwipeLeft: () => setSidebarOpen(true),
    disabled: !selectedId || listDrawerOpen || sidebarOpen,
  })

  return (
    <div className="flex min-h-0 flex-1" {...swipeHandlers}>
      {/* ---- left: issue list ---- */}
      <div
        className={clsx(
          "w-full shrink-0 flex-col border-r border-line bg-surface md:w-80",
          selectedId ? "hidden md:flex" : "flex",
        )}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-line px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">
            Issues
          </span>
          {activeRepoId && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void syncIssues()}
                disabled={syncing}
                title="同步 Issues"
                className="flex h-7 w-7 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2 disabled:opacity-40"
              >
                <RefreshCw
                  className={clsx("h-3.5 w-3.5", syncing && "animate-spin")}
                />
              </button>
              <button
                type="button"
                onClick={() => setCreating((v) => !v)}
                title="新建 Issue"
                className={clsx(
                  "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                  creating
                    ? "bg-blue-600 text-white"
                    : "text-fg-4 hover:bg-elevated hover:text-fg-2",
                )}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* create form */}
        {creating && <CreateForm onDone={() => setCreating(false)} />}

        {/* filter tabs */}
        <div className="flex border-b border-line">
          {STATE_FILTERS.map(({ key, label }) => {
            const count =
              key === "open"
                ? openCount
                : key === "closed"
                  ? closedCount
                  : issues.length
            return (
              <button
                key={key}
                type="button"
                onClick={() => setStateFilter(key)}
                className={clsx(
                  "flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors",
                  stateFilter === key
                    ? "border-b-2 border-blue-500 text-blue-500"
                    : "text-fg-4 hover:text-fg-2",
                )}
              >
                {label}
                <span
                  className={clsx(
                    "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                    stateFilter === key
                      ? "bg-blue-500/10 text-blue-500"
                      : "bg-elevated text-fg-5",
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
          {(["epic", "stray"] as const).map((key) => {
            const label = key === "epic" ? "Epic" : "游离"
            const count = key === "epic" ? epicCount : strayCount
            const active = typeFilter === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTypeFilter(active ? "all" : key)}
                className={clsx(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
                  active
                    ? key === "epic"
                      ? "bg-amber-400/15 text-amber-400"
                      : "bg-sky-400/15 text-sky-400"
                    : "bg-elevated/60 text-fg-5 hover:bg-elevated hover:text-fg-3",
                )}
              >
                {label}
                <span className={clsx(
                  "rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium",
                  active ? "opacity-70" : "text-fg-6",
                )}>
                  {count}
                </span>
              </button>
            )
          })}
          <div className="ml-auto flex items-center gap-1">
            {(["all", "task"] as const).map((key) => {
              const label = key === "all" ? "全部" : "任务"
              const count = key === "all" ? afterState.length : taskCount
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTypeFilter(key)}
                  className={clsx(
                    "rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                    typeFilter === key
                      ? "bg-fg-6/20 text-fg-3"
                      : "text-fg-6 hover:text-fg-4",
                  )}
                >
                  {label} {count}
                </button>
              )
            })}
          </div>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
            {tags.map((tag) => {
              const active = selectedTagIds.has(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTagFilter(tag.id)}
                  className={clsx(
                    "rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                    active ? "ring-1 ring-current" : "opacity-60 hover:opacity-100",
                  )}
                  style={{
                    backgroundColor: `#${tag.color}20`,
                    color: `#${tag.color}`,
                  }}
                >
                  {tag.name}
                </button>
              )
            })}
            {selectedTagIds.size > 0 && (
              <button
                type="button"
                onClick={clearTagFilter}
                className="ml-1 rounded px-1.5 py-0.5 text-[10px] text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3"
              >
                清除
              </button>
            )}
          </div>
        )}

        {/* search */}
        <div className="border-b border-line px-3 py-2">
          <div className="flex items-center gap-2 rounded-md border border-line bg-base px-2 py-1">
            <Search className="h-3.5 w-3.5 shrink-0 text-fg-5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 issue..."
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-fg placeholder:text-fg-6 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="shrink-0 text-fg-5 hover:text-fg-3"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {!activeRepoId ? (
            <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">
              请先选择一个仓库
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">
              {issues.length === 0 ? "点击 ↻ 同步 Issues" : "无匹配 Issue"}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  sessionCount={sessionCounts.get(issue.id) ?? 0}
                  isActive={selectedId === issue.id}
                  isEpic={issueType(issue) === "epic"}
                  onSelect={() => {
                    setSelectedId(issue.id)
                    setTreeRootId(issueType(issue) === "epic" ? issue.id : null)
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Mobile left drawer — quick issue list for swipe navigation */}
      <SwipeDrawer side="left" open={listDrawerOpen} onClose={() => setListDrawerOpen(false)}>
        <div className="flex h-full flex-col">
          <div className="border-b border-line px-3 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">Issues</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {filtered.length === 0 ? (
              <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">无匹配 Issue</p>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    sessionCount={sessionCounts.get(issue.id) ?? 0}
                    isActive={selectedId === issue.id}
                    isEpic={issueType(issue) === "epic"}
                    onSelect={() => {
                      setSelectedId(issue.id)
                      setTreeRootId(issueType(issue) === "epic" ? issue.id : null)
                      setListDrawerOpen(false)
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </SwipeDrawer>

      {/* ---- right: detail + overlay sidebar ---- */}
      <div
        className={clsx(
          "relative min-w-0 flex-1 flex-col bg-term md:flex",
          selectedId ? "flex" : "hidden",
        )}
      >
        {selectedIssue ? (
          <>
            <IssueDetail
              issue={selectedIssue}
              onBack={() => { setSelectedId(null); setTreeRootId(null); setSidebarOpen(false) }}
              onToggleSidebar={() => setSidebarOpen((v) => !v)}
            />

            {/* Sidebar overlay panel */}
            {sidebarOpen && (
              <>
                <div
                  className="absolute inset-0 z-10 bg-black/30"
                  onClick={() => setSidebarOpen(false)}
                />
                <div className="absolute right-0 top-0 bottom-0 z-20 flex w-[280px] flex-col border-l border-line bg-surface shadow-xl">
                  <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-4">
                      {treeRootId ? "子任务树 & 运行记录" : "运行记录"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSidebarOpen(false)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    {treeRootId ? (() => {
                      const rootIssue = issues.find((i) => i.id === treeRootId)
                      if (!rootIssue) return null
                      return (
                        <IssueTreeSidebar
                          rootIssue={rootIssue}
                          childrenMap={childrenMap}
                          currentId={selectedId}
                          onSelect={setSelectedId}
                          sessions={selectedIssueSessions}
                          onSessionSelect={handleSessionSelect}
                        />
                      )
                    })() : (
                      <IssueSessionSidebar
                        sessions={selectedIssueSessions}
                        onSessionSelect={handleSessionSelect}
                      />
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="font-mono text-xs text-fg-5">
              {!activeRepoId
                ? "请先选择一个仓库"
                : issues.length === 0
                  ? "点击 ↻ 同步 Issues 后选择查看"
                  : "← 选择一个 Issue 查看详情"}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

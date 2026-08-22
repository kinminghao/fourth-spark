import { useEffect, useState, useRef, useCallback, type KeyboardEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  CircleDot,
  Flag,
  GitPullRequest,
  Network,
  Plus,
  RefreshCw,
  Search,
  MessageCircle,
  Sparkles,
  X,
} from "lucide-react"
import clsx from "clsx"
import { type Issue, type Milestone, type PersistentPullRequest, type PullRequest, type Session, listIssuePullRequests, getPull, getSessionStatus, polishIssueCreate, getIssueCreateDraft, deleteIssueCreateDraft } from "../lib/api-client"
import { useIssueStore } from "../stores/issue-store"
import { usePrStore } from "../stores/pr-store"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { useSessionStore } from "../stores/session-store"
import { useToastStore } from "../stores/toast-store"
import { useSwipeDrawer } from "../hooks/use-swipe-drawer"
import { SwipeDrawer } from "../components/SwipeDrawer"
import { IssueDetailPanel } from "../components/IssueDetailPanel"
import { PrDetailPanel } from "../components/PrDetailPanel"
import { LinkedPrList } from "../components/LinkedPrList"
import { relativeTime } from "../lib/date-utils"

type StateFilter = "open" | "closed" | "all"
type TypeFilter = "all" | "epic" | "task" | "stray"
type DetailTab = "issue" | "pr"

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
  const [phase, setPhase] = useState<"idle" | "polishing" | "preview">("idle")
  const [polishedTitle, setPolishedTitle] = useState("")
  const [polishedBody, setPolishedBody] = useState("")
  const [polishSessionId, setPolishSessionId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const createIssue = useIssueStore((s) => s.createIssue)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const repoName = useRepoStore(selectActiveRepoName)
  const navigate = useNavigate()

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  useEffect(() => {
    if (!activeRepoId) return
    let cancelled = false
    getIssueCreateDraft(activeRepoId)
      .then((result) => {
        if (!cancelled && result.title) {
          setPolishedTitle(result.title)
          setPolishedBody(result.body)
          setPhase("preview")
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeRepoId])

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    await createIssue(title.trim(), body.trim() || undefined)
    setBusy(false)
    onDone()
  }

  const submitPolished = async () => {
    if (!polishedTitle.trim() || busy) return
    setBusy(true)
    await createIssue(polishedTitle.trim(), polishedBody.trim() || undefined)
    if (activeRepoId) deleteIssueCreateDraft(activeRepoId).catch(() => {})
    setBusy(false)
    setPhase("idle")
    setPolishedTitle("")
    setPolishedBody("")
    setPolishSessionId(null)
    onDone()
  }

  const handlePolish = async () => {
    if (!title.trim() || !activeRepoId || phase === "polishing") return
    setPhase("polishing")
    try {
      const { sessionId } = await polishIssueCreate(activeRepoId, title.trim(), body.trim() || undefined)
      setPolishSessionId(sessionId)

      pollRef.current = setInterval(async () => {
        try {
          const status = await getSessionStatus(activeRepoId, sessionId)
          if (status.type === "idle") {
            stopPolling()
            const result = await getIssueCreateDraft(activeRepoId)
            setPolishedTitle(result.title)
            setPolishedBody(result.body)
            setPhase("preview")
          }
        } catch {
          stopPolling()
          setPhase("idle")
          useToastStore.getState().addToast("润色状态检查失败", "error")
        }
      }, 2000)
    } catch (err) {
      setPhase("idle")
      useToastStore.getState().addToast(err instanceof Error ? err.message : "润色启动失败", "error")
    }
  }

  const handleDiscard = () => {
    stopPolling()
    if (activeRepoId) deleteIssueCreateDraft(activeRepoId).catch(() => {})
    setPolishedTitle("")
    setPolishedBody("")
    setPolishSessionId(null)
    setPhase("idle")
  }

  const handleEscalate = () => {
    if (!polishSessionId || !repoName) return
    useSessionStore.setState({ activeSessionId: polishSessionId })
    navigate(`/${encodeURIComponent(repoName)}/run`)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      void submit()
    }
  }

  if (phase === "preview") {
    return (
      <div className="border-b border-line px-3 py-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-4">
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          AI 润色结果
        </h4>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
          <input
            type="text"
            value={polishedTitle}
            onChange={(e) => setPolishedTitle(e.target.value)}
            className="w-full bg-transparent text-xs font-medium text-fg placeholder:text-fg-6 focus:outline-none"
            placeholder="润色后标题"
          />
          <textarea
            value={polishedBody}
            onChange={(e) => setPolishedBody(e.target.value)}
            rows={5}
            className="mt-2 w-full resize-none bg-transparent text-xs text-fg placeholder:text-fg-6 focus:outline-none"
            placeholder="润色后描述"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={!polishedTitle.trim() || busy}
            onClick={() => void submitPolished()}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            创建 Issue
          </button>
          <button
            type="button"
            onClick={() => void handlePolish()}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-fg-3 transition-colors hover:border-fg-5 hover:text-fg"
          >
            <Sparkles className="h-3.5 w-3.5" />
            重新润色
          </button>
          <button
            type="button"
            onClick={handleEscalate}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-fg-3 transition-colors hover:border-blue-500/50 hover:text-blue-400"
          >
            转入深度对话
          </button>
          <button
            type="button"
            onClick={handleDiscard}
            className="ml-auto rounded-md px-2.5 py-1 text-xs text-fg-5 transition-colors hover:text-fg-3"
          >
            放弃
          </button>
        </div>
      </div>
    )
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
        disabled={phase === "polishing"}
        className="w-full rounded-md border border-line bg-base px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-6 focus:border-fg-5 focus:outline-none disabled:opacity-50"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="描述（可选）  ⌘⏎ 创建"
        rows={3}
        disabled={phase === "polishing"}
        className="mt-2 w-full resize-none rounded-md border border-line bg-base px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-6 focus:border-fg-5 focus:outline-none disabled:opacity-50"
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
          disabled={!title.trim() || phase === "polishing"}
          onClick={() => void handlePolish()}
          className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {phase === "polishing" ? "润色中..." : "AI 润色"}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!title.trim() || busy || phase === "polishing"}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          直接创建
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
  milestone,
  onSelect,
}: {
  issue: Issue
  sessionCount: number
  isActive: boolean
  isEpic?: boolean
  milestone?: Milestone
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={clsx(
          "group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
          isActive
            ? "border-l-2 border-blue-500 bg-elevated/80"
            : "border-l-2 border-transparent hover:bg-elevated/50",
        )}
      >
        <span
          className={clsx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold",
            issue.state === "open"
              ? "bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-emerald-400 ring-1 ring-emerald-500/25"
              : "bg-gradient-to-br from-purple-500/20 to-purple-500/5 text-purple-400 ring-1 ring-purple-500/25",
          )}
        >
          {issue.number}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isEpic && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold tracking-wide bg-amber-400/12 text-amber-400">
                EPIC
              </span>
            )}
            <span className="min-w-0 text-xs font-medium text-fg-2 group-hover:text-fg">
              {issue.title}
            </span>
          </div>

          {issue.labels && issue.labels.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {issue.labels.map((l) => (
                <span
                  key={l.id}
                  className="rounded px-1 py-0.5 text-[10px] font-medium"
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

          {milestone && (
            <span className="mt-1 flex items-center gap-1 text-[10px] text-indigo-400/70">
              <Flag className="h-2.5 w-2.5" />
              {milestone.title}
            </span>
          )}
        </div>

        {sessionCount > 0 && (
          <span className="shrink-0 rounded-full bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">
            {sessionCount}
          </span>
        )}
      </button>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/*  Full-width issue row (for list mode)                              */
/* ------------------------------------------------------------------ */

function FullWidthIssueRow({
  issue,
  sessionCount,
  isEpic,
  milestone,
  onSelect,
}: {
  issue: Issue
  sessionCount: number
  isEpic?: boolean
  milestone?: Milestone
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="group flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-elevated/50"
      >
        <span
          className={clsx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold",
            issue.state === "open"
              ? "bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-emerald-400 ring-1 ring-emerald-500/25"
              : "bg-gradient-to-br from-purple-500/20 to-purple-500/5 text-purple-400 ring-1 ring-purple-500/25",
          )}
        >
          {issue.number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isEpic && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide bg-amber-400/12 text-amber-400">
                EPIC
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-2 group-hover:text-fg">
              {issue.title}
            </span>
            {milestone && (
              <span className="hidden shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-indigo-500/15 text-indigo-400 sm:flex">
                <Flag className="h-2.5 w-2.5" />
                {milestone.title}
              </span>
            )}
            {sessionCount > 0 && (
              <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 font-mono text-[10px] text-fg-5">
                {sessionCount} 次运行
              </span>
            )}
            {issue.assignees && issue.assignees.length > 0 && (
              <div className="hidden shrink-0 items-center -space-x-1.5 sm:flex">
                {issue.assignees.slice(0, 3).map((a) => (
                  <img key={a.login} src={a.avatar_url} alt={a.login} title={a.login} className="h-5 w-5 rounded-full ring-2 ring-surface" />
                ))}
                {issue.assignees.length > 3 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-elevated text-[9px] font-medium text-fg-4 ring-2 ring-surface">
                    +{issue.assignees.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {issue.authorLogin && (
              <span className="shrink-0 text-[11px] text-fg-5" title={issue.authorLogin}>
                {issue.authorAvatar && <img src={issue.authorAvatar} alt="" className="mr-1 inline-block h-3.5 w-3.5 rounded-full align-text-bottom" />}
                {issue.authorLogin}
              </span>
            )}
            {issue.authorLogin && <span className="text-fg-6">·</span>}
            <span className="shrink-0 text-[11px] text-fg-6">{relativeTime(issue.createdAt)}</span>
            {(issue.commentCount ?? 0) > 0 && (
              <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-fg-6">
                <span className="text-fg-6">·</span>
                <MessageCircle className="h-3 w-3" />
                {issue.commentCount}
              </span>
            )}
            {((issue.labels && issue.labels.length > 0) || (issue.commentCount ?? 0) > 0 || issue.authorLogin) && issue.labels && issue.labels.length > 0 && (
              <span className="text-fg-6">·</span>
            )}
            {issue.labels && issue.labels.length > 0 ? (
              issue.labels.map((l) => (
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
              ))
            ) : !issue.authorLogin ? (
              <span className="text-[11px] text-fg-6">&nbsp;</span>
            ) : null}
          </div>
        </div>
      </button>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/*  Detail panel wrapper — Issue view + PR tab                        */
/* ------------------------------------------------------------------ */

function IssueDetailWithTabs({
  issue,
  milestone,
  tab,
  prNumber,
  onTabChange,
  onSelectPr,
  onBackToPrList,
  onBack,
  onClose,
  onToggleSidebar,
}: {
  issue: Issue
  milestone?: Milestone
  tab: DetailTab
  prNumber: number | null
  onTabChange: (tab: DetailTab) => void
  onSelectPr: (prNumber: number) => void
  onBackToPrList: () => void
  onBack?: () => void
  onClose?: () => void
  onToggleSidebar?: () => void
}) {
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const enterMatchMode = usePrStore((s) => s.enterMatchMode)
  const [linkedPRs, setLinkedPRs] = useState<PullRequest[]>([])
  const [selectedPr, setSelectedPr] = useState<PersistentPullRequest | null>(null)
  const [loadingPr, setLoadingPr] = useState(false)

  useEffect(() => {
    if (!activeRepoId) {
      setLinkedPRs([])
      return
    }
    listIssuePullRequests(activeRepoId, issue.number)
      .then(setLinkedPRs)
      .catch(() => setLinkedPRs([]))
  }, [activeRepoId, issue.number])

  useEffect(() => {
    if (!activeRepoId || prNumber == null) {
      setSelectedPr(null)
      return
    }
    let cancelled = false
    setLoadingPr(true)
    getPull(activeRepoId, prNumber)
      .then((pr) => { if (!cancelled) setSelectedPr(pr) })
      .catch(() => { if (!cancelled) setSelectedPr(null) })
      .finally(() => { if (!cancelled) setLoadingPr(false) })
    return () => { cancelled = true }
  }, [activeRepoId, prNumber])

  const hasConflict = linkedPRs.some((p) => p.mergeable === false)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {linkedPRs.length > 0 && (
        <div className="flex shrink-0 items-center border-b border-line bg-surface">
          <button
            type="button"
            onClick={() => onTabChange("issue")}
            className={clsx(
              "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors",
              tab === "issue"
                ? "border-blue-500 text-fg"
                : "border-transparent text-fg-4 hover:text-fg-2",
            )}
          >
            <CircleDot className="h-3.5 w-3.5" />
            Issue
          </button>
          <button
            type="button"
            onClick={() => onTabChange("pr")}
            className={clsx(
              "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors",
              tab === "pr"
                ? "border-blue-500 text-fg"
                : "border-transparent text-fg-4 hover:text-fg-2",
            )}
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            PR
            <span className={clsx(
              "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
              tab === "pr" ? "bg-blue-500/10 text-blue-500" : "bg-elevated text-fg-5",
            )}>
              {linkedPRs.length}
            </span>
            {hasConflict && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-400">
                <AlertTriangle className="inline h-3 w-3 -mt-px" /> Conflict
              </span>
            )}
          </button>
        </div>
      )}

      {tab === "issue" || linkedPRs.length === 0 ? (
        <IssueDetailPanel
          issue={issue}
          milestone={milestone}
          onBack={onBack}
          onClose={onClose}
          onToggleSidebar={onToggleSidebar}
        />
      ) : prNumber != null ? (
        selectedPr ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center border-b border-line bg-elevated/30 px-4 py-2">
              <button
                type="button"
                onClick={onBackToPrList}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                返回列表
              </button>
            </div>
            <PrDetailPanel
              pr={selectedPr}
              onBack={onBackToPrList}
              onEnterMatch={() => enterMatchMode(selectedPr.id)}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="font-mono text-xs text-fg-5">{loadingPr ? "加载 PR…" : "PR 未找到"}</p>
          </div>
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
            <LinkedPrList prs={linkedPRs} onSelect={onSelectPr} />
          </div>
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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("stray")
  const [creating, setCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [treeRootId, setTreeRootId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [listDrawerOpen, setListDrawerOpen] = useState(false)
  const [expandedFilter, setExpandedFilter] = useState<"type" | "tag" | "milestone" | "author" | "assignee" | null>(null)
  const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null)
  const [selectedAssignee, setSelectedAssignee] = useState<string | null>(null)

  const [searchParams, setSearchParams] = useSearchParams()

  const issues = useIssueStore((s) => s.issues)
  const syncing = useIssueStore((s) => s.syncing)
  const syncIssues = useIssueStore((s) => s.syncIssues)
  const tags = useIssueStore((s) => s.tags)
  const tagFilterMode = useIssueStore((s) => s.tagFilterMode)
  const cycleTagFilter = useIssueStore((s) => s.cycleTagFilter)
  const clearTagFilter = useIssueStore((s) => s.clearTagFilter)
  const loadTags = useIssueStore((s) => s.loadTags)
  const milestones = useIssueStore((s) => s.milestones)
  const selectedMilestoneId = useIssueStore((s) => s.selectedMilestoneId)
  const setMilestoneFilter = useIssueStore((s) => s.setMilestoneFilter)
  const loadMilestones = useIssueStore((s) => s.loadMilestones)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const sessions = useSessionStore((s) => s.sessions)

  const selectedId = searchParams.get("id")
  const tab: DetailTab = searchParams.get("tab") === "pr" ? "pr" : "issue"
  const prNumberParam = searchParams.get("prId")
  const prNumber = prNumberParam ? Number.parseInt(prNumberParam, 10) : null

  useEffect(() => {
    const legacy = searchParams.get("issueId")
    if (!legacy) return
    const next = new URLSearchParams(searchParams)
    next.delete("issueId")
    next.set("id", legacy)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const openIssue = useCallback((id: string) => {
    setSearchParams({ id }, { replace: false })
  }, [setSearchParams])

  const closeIssue = useCallback(() => {
    setSearchParams({}, { replace: false })
  }, [setSearchParams])

  const changeTab = useCallback((newTab: DetailTab) => {
    if (!selectedId) return
    const params: Record<string, string> = { id: selectedId }
    if (newTab === "pr") params.tab = "pr"
    setSearchParams(params, { replace: false })
  }, [selectedId, setSearchParams])

  const openPr = useCallback((num: number) => {
    if (!selectedId) return
    setSearchParams({ id: selectedId, tab: "pr", prId: String(num) }, { replace: false })
  }, [selectedId, setSearchParams])

  const backToPrList = useCallback(() => {
    if (!selectedId) return
    setSearchParams({ id: selectedId, tab: "pr" }, { replace: false })
  }, [selectedId, setSearchParams])

  useEffect(() => {
    if (activeRepoId) {
      void loadTags()
      void loadMilestones()
    }
  }, [activeRepoId, loadTags, loadMilestones])

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

  const milestoneMap = new Map(milestones.map((m) => [m.id, m]))

  const afterState = stateFilter === "all" ? issues : issues.filter((i) => i.state === stateFilter)
  const afterType = typeFilter === "all" ? afterState : afterState.filter((i) => issueType(i) === typeFilter)
  const afterTags = tagFilterMode.size === 0
    ? afterType
    : afterType.filter((i) => {
        const issueTagNames = new Set((i.labels ?? []).map((l) => l.name))
        for (const [tagId, mode] of tagFilterMode) {
          const tagName = tags.find((t) => t.id === tagId)?.name
          if (!tagName) continue
          if (mode === "include" && !issueTagNames.has(tagName)) return false
          if (mode === "exclude" && issueTagNames.has(tagName)) return false
        }
        return true
      })
  const sq = searchQuery.trim().toLowerCase()
  const filtered = !sq
    ? afterTags
    : afterTags.filter((i) => `#${i.number} ${i.title}`.toLowerCase().includes(sq))
  const afterMilestone = selectedMilestoneId
    ? filtered.filter((i) => i.milestoneId === selectedMilestoneId)
    : filtered
  const afterAuthor = !selectedAuthor
    ? afterMilestone
    : afterMilestone.filter((i) => i.authorLogin === selectedAuthor)
  const finalFiltered = !selectedAssignee
    ? afterAuthor
    : afterAuthor.filter((i) => (i.assignees ?? []).some((a) => a.login === selectedAssignee))

  const uniqueAuthors = (() => {
    const m = new Map<string, { login: string; avatar: string | undefined }>()
    for (const i of issues) if (i.authorLogin && !m.has(i.authorLogin)) m.set(i.authorLogin, { login: i.authorLogin, avatar: i.authorAvatar })
    return [...m.values()]
  })()
  const uniqueAssignees = (() => {
    const m = new Map<string, { login: string; avatar: string | undefined }>()
    for (const i of issues) for (const a of i.assignees ?? []) if (!m.has(a.login)) m.set(a.login, { login: a.login, avatar: a.avatar_url })
    return [...m.values()]
  })()

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

  const repoName = useRepoStore(selectActiveRepoName)
  const handleSessionSelect = (sessionId: string) => {
    useSessionStore.setState({ activeSessionId: sessionId })
    navigate(`/${encodeURIComponent(repoName!)}/run`)
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
          "shrink-0 flex-col bg-surface",
          selectedId
            ? "hidden md:flex md:w-80 border-r border-line"
            : "flex w-full",
        )}
      >
        {!selectedId ? (
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-line px-4 py-2.5">
              {/* Title */}
              <span className="shrink-0 text-sm font-semibold text-fg md:order-1">Issues</span>
              {/* Sync/Create: right-aligned on mobile, end of row on desktop */}
              {activeRepoId && (
                <div className="ml-auto flex shrink-0 items-center gap-1 md:order-last md:ml-0">
                  <button
                    type="button"
                    onClick={() => void syncIssues()}
                    disabled={syncing}
                    title="同步 Issues"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2 disabled:opacity-40"
                  >
                    <RefreshCw className={clsx("h-3.5 w-3.5", syncing && "animate-spin")} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreating((v) => !v)}
                    title="新建 Issue"
                    className={clsx(
                      "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                      creating ? "bg-blue-600 text-white" : "text-fg-4 hover:bg-elevated hover:text-fg-2",
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {/* State filters: new row on mobile */}
              <div className="w-full md:order-2 md:w-auto">
                <div className="flex shrink-0 items-center rounded-lg bg-elevated/60 p-0.5">
                  {STATE_FILTERS.map(({ key, label }) => {
                    const count = key === "open" ? openCount : key === "closed" ? closedCount : issues.length
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setStateFilter(key)}
                        className={clsx(
                          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          stateFilter === key
                            ? "bg-surface text-fg shadow-sm"
                            : "text-fg-4 hover:text-fg-2",
                        )}
                      >
                        {label}
                        <span className={clsx(
                          "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                          stateFilter === key ? "bg-blue-500/10 text-blue-500" : "text-fg-5",
                        )}>
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
              {/* Search: new row on mobile, inline on desktop */}
              <div className="w-full md:order-5 md:w-auto md:min-w-0 md:flex-1 md:px-1">
                <div className="flex items-center gap-2 rounded-md border border-line bg-base px-2.5 py-1.5">
                  <Search className="h-3.5 w-3.5 shrink-0 text-fg-5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索 issue..."
                    className="min-w-0 flex-1 bg-transparent text-xs text-fg placeholder:text-fg-6 focus:outline-none"
                  />
                  {searchQuery && (
                    <button type="button" onClick={() => setSearchQuery("")} className="shrink-0 text-fg-5 hover:text-fg-3">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
              {/* Divider: desktop only */}
              <div className="hidden md:order-3 md:mx-1 md:block md:h-4 md:w-px md:shrink-0 md:bg-line" />
              {/* Filter buttons: scrollable row on mobile */}
              <div className="flex w-full gap-2 overflow-x-auto scrollbar-none md:order-4 md:w-auto md:overflow-visible">
                <button
                  type="button"
                  onClick={() => setExpandedFilter(expandedFilter === "type" ? null : "type")}
                  className={clsx(
                    "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    expandedFilter === "type" ? "bg-elevated text-fg"
                      : typeFilter !== "all" ? "text-fg-2" : "text-fg-4 hover:bg-elevated/60 hover:text-fg-2",
                  )}
                >
                  类型
                  {typeFilter !== "all" && (
                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">
                      {typeFilter === "epic" ? "Epic" : typeFilter === "task" ? "任务" : "游离"}
                    </span>
                  )}
                  <ChevronDown className={clsx("h-3 w-3 transition-transform", expandedFilter === "type" && "rotate-180")} />
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedFilter(expandedFilter === "tag" ? null : "tag")}
                  className={clsx(
                    "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    expandedFilter === "tag" ? "bg-elevated text-fg"
                      : tagFilterMode.size > 0 ? "text-fg-2" : "text-fg-4 hover:bg-elevated/60 hover:text-fg-2",
                  )}
                >
                  标签
                  {tagFilterMode.size > 0 && (
                    <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">
                      {tagFilterMode.size}
                    </span>
                  )}
                  <ChevronDown className={clsx("h-3 w-3 transition-transform", expandedFilter === "tag" && "rotate-180")} />
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedFilter(expandedFilter === "milestone" ? null : "milestone")}
                  className={clsx(
                    "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    expandedFilter === "milestone" ? "bg-elevated text-fg"
                      : selectedMilestoneId ? "text-fg-2" : "text-fg-4 hover:bg-elevated/60 hover:text-fg-2",
                  )}
                >
                  Milestone
                  {selectedMilestoneId && (() => {
                    const ms = milestones.find((m) => m.id === selectedMilestoneId)
                    return ms ? <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">{ms.title}</span> : null
                  })()}
                  <ChevronDown className={clsx("h-3 w-3 transition-transform", expandedFilter === "milestone" && "rotate-180")} />
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedFilter(expandedFilter === "author" ? null : "author")}
                  className={clsx(
                    "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    expandedFilter === "author" ? "bg-elevated text-fg"
                      : selectedAuthor ? "text-fg-2" : "text-fg-4 hover:bg-elevated/60 hover:text-fg-2",
                  )}
                >
                  Author
                  {selectedAuthor && (
                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">{selectedAuthor}</span>
                  )}
                  <ChevronDown className={clsx("h-3 w-3 transition-transform", expandedFilter === "author" && "rotate-180")} />
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedFilter(expandedFilter === "assignee" ? null : "assignee")}
                  className={clsx(
                    "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    expandedFilter === "assignee" ? "bg-elevated text-fg"
                      : selectedAssignee ? "text-fg-2" : "text-fg-4 hover:bg-elevated/60 hover:text-fg-2",
                  )}
                >
                  Assignee
                  {selectedAssignee && (
                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">{selectedAssignee}</span>
                  )}
                  <ChevronDown className={clsx("h-3 w-3 transition-transform", expandedFilter === "assignee" && "rotate-180")} />
                </button>
              </div>
            </div>
            {expandedFilter === "type" && (
              <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2" style={{ scrollbarWidth: "none" }}>
                {(["epic", "stray", "task", "all"] as const).map((key) => {
                  const label = key === "epic" ? "Epic" : key === "stray" ? "游离" : key === "task" ? "任务" : "全部"
                  const count = key === "epic" ? epicCount : key === "stray" ? strayCount : key === "task" ? taskCount : afterState.length
                  const active = typeFilter === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTypeFilter(active && key !== "all" ? "all" : key)}
                      className={clsx(
                        "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
                        active
                          ? key === "epic" ? "bg-amber-400/15 text-amber-400"
                            : key === "stray" ? "bg-sky-400/15 text-sky-400"
                            : key === "task" ? "bg-violet-400/15 text-violet-400"
                            : "bg-fg-6/20 text-fg-3"
                          : "bg-elevated/60 text-fg-5 hover:bg-elevated hover:text-fg-3",
                      )}
                    >
                      {label}
                      <span className={clsx("rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium", active ? "opacity-70" : "text-fg-6")}>
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            {expandedFilter === "tag" && (
              <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2" style={{ scrollbarWidth: "none" }}>
                {tags.length === 0 ? (
                  <span className="text-xs text-fg-5">暂无标签</span>
                ) : (
                  <>
                    {tags.map((tag) => {
                      const mode = tagFilterMode.get(tag.id)
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => cycleTagFilter(tag.id)}
                          className={clsx(
                            "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                            mode === "include"
                              ? "ring-1 ring-current shadow-sm"
                              : mode === "exclude"
                                ? "opacity-90 line-through decoration-2"
                                : "opacity-50 hover:opacity-80",
                          )}
                          style={mode === "exclude"
                            ? { backgroundColor: `#${tag.color}10`, color: `#${tag.color}`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, #${tag.color} 30%, transparent)` }
                            : { backgroundColor: `#${tag.color}18`, color: `#${tag.color}`, boxShadow: mode === "include" ? `inset 0 0 0 1px color-mix(in srgb, #${tag.color} 50%, transparent)` : undefined }
                          }
                        >
                          {mode === "exclude" && <span className="mr-1 text-[10px]">✕</span>}
                          {tag.name}
                        </button>
                      )
                    })}
                    {tagFilterMode.size > 0 && (
                      <button type="button" onClick={clearTagFilter}
                        className="shrink-0 rounded-md px-2 py-1 text-[10px] text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3">
                        清除
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {expandedFilter === "milestone" && (
              <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2" style={{ scrollbarWidth: "none" }}>
                {milestones.length === 0 ? (
                  <span className="text-xs text-fg-5">暂无里程碑</span>
                ) : (
                  <>
                    {milestones.map((ms) => {
                      const active = selectedMilestoneId === ms.id
                      return (
                        <button
                          key={ms.id}
                          type="button"
                          onClick={() => setMilestoneFilter(active ? null : ms.id)}
                          className={clsx(
                            "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                            active
                              ? "bg-indigo-500/15 text-indigo-400 ring-1 ring-indigo-400/50 shadow-sm"
                              : "bg-elevated/60 text-fg-5 hover:bg-elevated hover:text-fg-3",
                          )}
                        >
                          {ms.title}
                          {ms.state === "closed" && <span className="ml-1 text-[10px] opacity-60">✓</span>}
                        </button>
                      )
                    })}
                    {selectedMilestoneId && (
                      <button type="button" onClick={() => setMilestoneFilter(null)}
                        className="shrink-0 rounded-md px-2 py-1 text-[10px] text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3">
                        清除
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {expandedFilter === "author" && (
              <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2" style={{ scrollbarWidth: "none" }}>
                {uniqueAuthors.length === 0 ? (
                  <span className="text-xs text-fg-5">同步后可见作者</span>
                ) : (
                  <>
                    {uniqueAuthors.map((a) => (
                      <button
                        key={a.login}
                        type="button"
                        onClick={() => setSelectedAuthor(selectedAuthor === a.login ? null : a.login)}
                        className={clsx(
                          "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          selectedAuthor === a.login
                            ? "bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30 shadow-sm"
                            : "bg-elevated/60 text-fg-5 hover:bg-elevated hover:text-fg-3",
                        )}
                      >
                        {a.avatar && <img src={a.avatar} alt="" className="h-4 w-4 rounded-full" />}
                        {a.login}
                      </button>
                    ))}
                    {selectedAuthor && (
                      <button type="button" onClick={() => setSelectedAuthor(null)}
                        className="shrink-0 rounded-md px-2 py-1 text-[10px] text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3">
                        清除
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {expandedFilter === "assignee" && (
              <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2" style={{ scrollbarWidth: "none" }}>
                {uniqueAssignees.length === 0 ? (
                  <span className="text-xs text-fg-5">同步后可见指派人</span>
                ) : (
                  <>
                    {uniqueAssignees.map((a) => (
                      <button
                        key={a.login}
                        type="button"
                        onClick={() => setSelectedAssignee(selectedAssignee === a.login ? null : a.login)}
                        className={clsx(
                          "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          selectedAssignee === a.login
                            ? "bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30 shadow-sm"
                            : "bg-elevated/60 text-fg-5 hover:bg-elevated hover:text-fg-3",
                        )}
                      >
                        {a.avatar && <img src={a.avatar} alt="" className="h-4 w-4 rounded-full" />}
                        {a.login}
                      </button>
                    ))}
                    {selectedAssignee && (
                      <button type="button" onClick={() => setSelectedAssignee(null)}
                        className="shrink-0 rounded-md px-2 py-1 text-[10px] text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3">
                        清除
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {creating && <CreateForm onDone={() => setCreating(false)} />}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-line px-3 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">Issues</span>
              {activeRepoId && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void syncIssues()}
                    disabled={syncing}
                    title="同步"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2 disabled:opacity-40"
                  >
                    <RefreshCw className={clsx("h-3.5 w-3.5", syncing && "animate-spin")} />
                  </button>
                </div>
              )}
            </div>
            {creating && <CreateForm onDone={() => setCreating(false)} />}
            <div className="flex border-b border-line">
              {STATE_FILTERS.map(({ key, label }) => {
                const count = key === "open" ? openCount : key === "closed" ? closedCount : issues.length
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
                    <span className={clsx(
                      "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                      stateFilter === key ? "bg-blue-500/10 text-blue-500" : "bg-elevated text-fg-5",
                    )}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
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
                  <button type="button" onClick={() => setSearchQuery("")} className="shrink-0 text-fg-5 hover:text-fg-3">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        <div className={clsx("flex-1 overflow-y-auto", selectedId ? "px-2 py-2" : "px-3 py-3")}>
          {!activeRepoId ? (
            <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">
              请先选择一个仓库
            </p>
          ) : finalFiltered.length === 0 ? (
            <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">
              {issues.length === 0 ? "点击 ↻ 同步 Issues" : "无匹配 Issue"}
            </p>
          ) : (
            <ul className={clsx(selectedId ? "space-y-0.5" : "space-y-1")}>
              {finalFiltered.map((issue) =>
                selectedId ? (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    sessionCount={sessionCounts.get(issue.id) ?? 0}
                    isActive={selectedId === issue.id}
                    isEpic={issueType(issue) === "epic"}
                    milestone={issue.milestoneId ? milestoneMap.get(issue.milestoneId) : undefined}
                    onSelect={() => {
                      openIssue(issue.id)
                      setTreeRootId(issueType(issue) === "epic" ? issue.id : null)
                    }}
                  />
                ) : (
                  <FullWidthIssueRow
                    key={issue.id}
                    issue={issue}
                    sessionCount={sessionCounts.get(issue.id) ?? 0}
                    isEpic={issueType(issue) === "epic"}
                    milestone={issue.milestoneId ? milestoneMap.get(issue.milestoneId) : undefined}
                    onSelect={() => {
                      openIssue(issue.id)
                      setTreeRootId(issueType(issue) === "epic" ? issue.id : null)
                    }}
                  />
                ),
              )}
            </ul>
          )}
        </div>
      </div>

      {selectedId && (
      <SwipeDrawer side="left" open={listDrawerOpen} onClose={() => setListDrawerOpen(false)}>
        <div className="flex h-full flex-col">
          <div className="border-b border-line px-3 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">Issues</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {finalFiltered.length === 0 ? (
              <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">无匹配 Issue</p>
            ) : (
              <ul className="space-y-0.5">
                {finalFiltered.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    sessionCount={sessionCounts.get(issue.id) ?? 0}
                    isActive={selectedId === issue.id}
                    isEpic={issueType(issue) === "epic"}
                    milestone={issue.milestoneId ? milestoneMap.get(issue.milestoneId) : undefined}
                    onSelect={() => {
                      openIssue(issue.id)
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
      )}

      {/* ---- right: detail + overlay sidebar ---- */}
      {selectedId && (
      <div className="relative flex min-w-0 flex-1 flex-col bg-term">
        {selectedIssue ? (
          <>
            <IssueDetailWithTabs
              issue={selectedIssue}
              milestone={selectedIssue.milestoneId ? milestoneMap.get(selectedIssue.milestoneId) : undefined}
              tab={tab}
              prNumber={prNumber}
              onTabChange={changeTab}
              onSelectPr={openPr}
              onBackToPrList={backToPrList}
              onBack={() => { closeIssue(); setTreeRootId(null); setSidebarOpen(false) }}
              onClose={() => { closeIssue(); setTreeRootId(null); setSidebarOpen(false) }}
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
                          onSelect={(id) => { openIssue(id); setSidebarOpen(false) }}
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
            <p className="font-mono text-xs text-fg-5">Issue 未找到</p>
          </div>
        )}
      </div>
      )}
    </div>
  )
}

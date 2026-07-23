import { useState, type KeyboardEvent } from "react"
import { useNavigate } from "react-router-dom"
import {
  ExternalLink,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import clsx from "clsx"
import type { Issue } from "../lib/api-client"
import { useIssueStore } from "../stores/issue-store"
import { useRepoStore } from "../stores/repo-store"
import { useSessionStore } from "../stores/session-store"

type StateFilter = "open" | "closed" | "all"
type TypeFilter = "all" | "epic" | "task" | "stray"

const STATE_FILTERS: { key: StateFilter; label: string }[] = [
  { key: "open", label: "开放" },
  { key: "closed", label: "已关闭" },
  { key: "all", label: "全部" },
]

const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "epic", label: "Epic" },
  { key: "task", label: "任务" },
  { key: "stray", label: "游离" },
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
  onSelect,
}: {
  issue: Issue
  sessionCount: number
  isActive: boolean
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

function IssueDetail({ issue }: { issue: Issue }) {
  const navigate = useNavigate()

  const handleStart = () => {
    useIssueStore.getState().setSelectedIssue(issue.id)
    useIssueStore.getState().setPreviewIssue(null)
    useSessionStore.setState({ activeSessionId: null })
    navigate("/run")
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-line px-6 py-4">
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

        <div className="flex items-center gap-2">
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
            onClick={handleStart}
            className="flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-500"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            开始处理
          </button>
        </div>
      </header>

      {/* body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {issue.body ? (
            <div className="markdown-body leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {issue.body}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="py-10 text-center font-mono text-xs text-fg-5">
              该 Issue 没有描述内容
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export function IssuesPage() {
  const [stateFilter, setStateFilter] = useState<StateFilter>("open")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const issues = useIssueStore((s) => s.issues)
  const syncing = useIssueStore((s) => s.syncing)
  const syncIssues = useIssueStore((s) => s.syncIssues)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const sessions = useSessionStore((s) => s.sessions)

  const sessionCounts = new Map<string, number>()
  for (const s of sessions) {
    if (s.issueId && !s.parentID) {
      sessionCounts.set(s.issueId, (sessionCounts.get(s.issueId) ?? 0) + 1)
    }
  }

  const childIssueIds = new Set(issues.filter((i) => i.parentId).map((i) => i.parentId!))

  function issueType(i: { parentId?: string; id: string }): "epic" | "task" | "stray" {
    if (i.parentId) return "task"
    if (childIssueIds.has(i.id)) return "epic"
    return "stray"
  }

  const afterState = stateFilter === "all" ? issues : issues.filter((i) => i.state === stateFilter)
  const filtered = typeFilter === "all" ? afterState : afterState.filter((i) => issueType(i) === typeFilter)

  const openCount = issues.filter((i) => i.state === "open").length
  const closedCount = issues.filter((i) => i.state === "closed").length
  const epicCount = afterState.filter((i) => issueType(i) === "epic").length
  const taskCount = afterState.filter((i) => issueType(i) === "task").length
  const strayCount = afterState.filter((i) => issueType(i) === "stray").length

  const selectedIssue = issues.find((i) => i.id === selectedId) ?? null

  return (
    <div className="flex min-h-0 flex-1">
      {/* ---- left: issue list ---- */}
      <div className="flex w-80 shrink-0 flex-col border-r border-line bg-surface">
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

        <div className="flex border-b border-line">
          {TYPE_FILTERS.map(({ key, label }) => {
            const count =
              key === "epic" ? epicCount
                : key === "task" ? taskCount
                : key === "stray" ? strayCount
                : afterState.length
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTypeFilter(key)}
                className={clsx(
                  "flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[10px] font-medium transition-colors",
                  typeFilter === key
                    ? "border-b-2 border-emerald-500 text-emerald-500"
                    : "text-fg-5 hover:text-fg-3",
                )}
              >
                {label}
                <span
                  className={clsx(
                    "rounded-full px-1.5 py-0.5 font-mono text-[9px]",
                    typeFilter === key
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-elevated text-fg-6",
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
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
                  onSelect={() => setSelectedId(issue.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---- right: detail ---- */}
      <div className="flex min-w-0 flex-1 flex-col bg-term">
        {selectedIssue ? (
          <IssueDetail issue={selectedIssue} />
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

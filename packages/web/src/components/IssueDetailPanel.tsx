import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ChevronLeft,
  CircleDot,
  ExternalLink,
  Flag,
  GitBranch,
  PanelRight,
  Play,
  X,
  XCircle,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"
import clsx from "clsx"
import { listIssueComments, type Issue, type IssueComment, type Milestone } from "../lib/api-client"
import { useIssueStore } from "../stores/issue-store"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { useSessionStore } from "../stores/session-store"
import { CommentComposer } from "./CommentComposer"
import { fmtDate } from "../lib/date-utils"

export function IssueDetailPanel({
  issue,
  milestone,
  onBack,
  onClose,
  onToggleSidebar,
}: {
  issue: Issue
  milestone?: Milestone
  onBack?: () => void
  onClose?: () => void
  onToggleSidebar?: () => void
}) {
  const navigate = useNavigate()
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const repoName = useRepoStore(selectActiveRepoName)
  const [comments, setComments] = useState<IssueComment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [togglingState, setTogglingState] = useState(false)
  const updateIssueState = useIssueStore((s) => s.updateIssueState)

  useEffect(() => {
    if (!activeRepoId) return
    setLoadingComments(true)
    listIssueComments(activeRepoId, issue.number)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setLoadingComments(false))
  }, [activeRepoId, issue.number])

  const handleStart = () => {
    useSessionStore.setState({ activeSessionId: null })
    navigate(`/${encodeURIComponent(repoName!)}/run?issueId=${encodeURIComponent(issue.id)}`)
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
            <div className="flex flex-wrap items-center gap-1.5">
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
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: `#${l.color}20`,
                    color: `#${l.color}`,
                  }}
                >
                  {l.name}
                </span>
              ))}
              {milestone && (
                <span className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-indigo-500/15 text-indigo-400">
                  <Flag className="h-2.5 w-2.5" />
                  {milestone.title}
                </span>
              )}
            </div>
            <h2 className="mt-1 text-base font-semibold text-fg">
              {issue.title}
            </h2>
            {(issue.authorLogin || (issue.assignees && issue.assignees.length > 0)) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-fg-4">
                {issue.authorLogin && (
                  <span className="flex items-center gap-1.5">
                    {issue.authorAvatar && <img src={issue.authorAvatar} alt="" className="h-4 w-4 rounded-full" />}
                    {issue.authorLogin}
                  </span>
                )}
                {issue.assignees && issue.assignees.length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="text-fg-5">→</span>
                    <span className="flex items-center -space-x-1">
                      {issue.assignees.map((a) => (
                        <img key={a.login} src={a.avatar_url} alt={a.login} title={a.login} className="h-4 w-4 rounded-full ring-1 ring-surface" />
                      ))}
                    </span>
                    <span className="text-fg-4">{issue.assignees.map((a) => a.login).join(", ")}</span>
                  </span>
                )}
              </div>
            )}
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
              <span className="hidden sm:inline">源站</span>
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              useIssueStore.getState().enterMatchMode(issue.id)
              useSessionStore.setState({ activeSessionId: null })
              navigate(`/${encodeURIComponent(repoName!)}/run`)
            }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-fg-3 transition-colors hover:border-blue-500/50 hover:text-blue-400"
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">匹配子任务</span>
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
                <span className="hidden sm:inline">关闭</span>
              </>
            ) : (
              <>
                <CircleDot className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">重新打开</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleStart}
            className="flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-500"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span className="hidden sm:inline">新建任务</span>
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
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="关闭详情"
              className="hidden h-8 w-8 items-center justify-center rounded-md border border-line text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-2 md:flex"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

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

          {activeRepoId && (
            <CommentComposer
              key={issue.id}
              repoId={activeRepoId}
              issueNumber={issue.number}
              onPublished={(comment) => setComments((prev) => [...prev, comment])}
            />
          )}
        </div>
      </div>
    </div>
  )
}

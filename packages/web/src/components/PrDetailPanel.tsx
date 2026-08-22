import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FileText,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Link2,
  Minus,
  Plus,
  Wrench,
  X,
  XCircle,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"
import clsx from "clsx"
import {
  ApiError,
  listPrLinkedIssues,
  listPullComments,
  mergePull,
  updateIssue,
  type Issue,
  type IssueComment,
  type PersistentPullRequest,
} from "../lib/api-client"
import { useIssueStore } from "../stores/issue-store"
import { usePrStore } from "../stores/pr-store"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { useSessionStore } from "../stores/session-store"
import { useToastStore } from "../stores/toast-store"
import { fmtDate, prStateColor, relativeTime } from "../lib/date-utils"

export function PrDetailPanel({
  pr,
  onBack,
  onClose,
  onEnterMatch,
  onNavigateToIssue,
}: {
  pr: PersistentPullRequest
  onBack?: () => void
  onClose?: () => void
  onEnterMatch: () => void
  onNavigateToIssue?: (issueId: string) => void
}) {
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const repoName = useRepoStore(selectActiveRepoName)
  const [merging, setMerging] = useState(false)
  const [comments, setComments] = useState<IssueComment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [linkedIssues, setLinkedIssues] = useState<Issue[]>([])
  const [filesExpanded, setFilesExpanded] = useState(false)
  const navigate = useNavigate()
  const unlinkIssue = usePrStore((s) => s.unlinkIssue)

  useEffect(() => {
    if (!activeRepoId) return
    setLoadingComments(true)
    listPullComments(activeRepoId, pr.number)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setLoadingComments(false))
  }, [activeRepoId, pr.number])

  useEffect(() => {
    if (!activeRepoId) return
    listPrLinkedIssues(activeRepoId, pr.number)
      .then(setLinkedIssues)
      .catch(() => setLinkedIssues([]))
  }, [activeRepoId, pr.number])

  const handleMerge = async (closeLinkedIssues: boolean) => {
    if (merging || !activeRepoId) return
    setMerging(true)
    try {
      await mergePull(activeRepoId, pr.number)
      if (closeLinkedIssues && linkedIssues.length > 0) {
        const openIssues = linkedIssues.filter((i) => i.state === "open")
        await Promise.all(openIssues.map((i) => updateIssue(activeRepoId, i.number, { state: "closed" })))
        setLinkedIssues((prev) => prev.map((i) => i.state === "open" ? { ...i, state: "closed" as const } : i))
        void useIssueStore.getState().loadIssues()
        useToastStore.getState().addToast(`PR #${pr.number} 合入成功，已关闭 ${openIssues.length} 个 Issue`, "success")
      } else {
        useToastStore.getState().addToast(`PR #${pr.number} 合入成功`, "success")
      }
      void usePrStore.getState().loadPulls()
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

  const handleUnlink = async (issueNumber: number) => {
    const ok = await unlinkIssue(pr.number, issueNumber)
    if (ok) setLinkedIssues((prev) => prev.filter((i) => i.number !== issueNumber))
  }

  const handleResolveConflict = () => {
    const draft = `请解决 PR #${pr.number} 的合并冲突: ${pr.title}`
    useSessionStore.setState({ activeSessionId: null })
    navigate(`/${encodeURIComponent(repoName!)}/run?draft=${encodeURIComponent(draft)}`)
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
              <span className={clsx("shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold", prStateColor(pr.state))}>
                #{pr.number} {pr.state}
              </span>
              {pr.draft === 1 && (
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold bg-fg-6/15 text-fg-4">DRAFT</span>
              )}
              {pr.mergeable === "false" && pr.state === "open" && (
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-400">Conflict</span>
              )}
              {pr.labels?.map((l) => (
                <span
                  key={l.id}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: `#${l.color}20`, color: `#${l.color}` }}
                >
                  {l.name}
                </span>
              ))}
            </div>
            <h2 className="mt-1 text-base font-semibold text-fg">{pr.title}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-fg-4">
              <span className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-fg-5">
                <GitPullRequest className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{pr.headBranch} → {pr.baseBranch}</span>
              </span>
              {pr.authorLogin && (
                <span className="flex items-center gap-1.5">
                  {pr.authorAvatar && <img src={pr.authorAvatar} alt="" className="h-4 w-4 rounded-full" />}
                  {pr.authorLogin}
                </span>
              )}
              {pr.mergedAt && (
                <span className="text-purple-400">合并于 {relativeTime(pr.mergedAt)}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {pr.htmlUrl && (
            <a
              href={pr.htmlUrl}
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
            onClick={onEnterMatch}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-fg-3 transition-colors hover:border-blue-500/50 hover:text-blue-400"
          >
            <Link2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">关联 Issue</span>
          </button>
          {pr.state === "open" && (
            <>
              {pr.mergeable === "false" && (
                <button
                  type="button"
                  onClick={handleResolveConflict}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-amber-500/30 px-2.5 text-xs font-medium text-amber-400 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">解冲突</span>
                </button>
              )}
              <button
                type="button"
                disabled={merging || pr.mergeable === "false"}
                onClick={() => void handleMerge(false)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/30 px-2.5 text-xs font-medium text-emerald-400 transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/10 disabled:opacity-40"
              >
                <GitMerge className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">合入</span>
              </button>
              {linkedIssues.some((i) => i.state === "open") && (
                <button
                  type="button"
                  disabled={merging || pr.mergeable === "false"}
                  onClick={() => void handleMerge(true)}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
                >
                  <GitMerge className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">合入并关闭 Issues</span>
                </button>
              )}
            </>
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
          {linkedIssues.length > 0 && (
            <div className="mb-6 rounded-lg border border-line bg-elevated/30 px-4 py-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-4">
                <CircleDot className="h-3.5 w-3.5" />
                关联 Issues ({linkedIssues.length})
              </h3>
              <div className="space-y-1.5">
                {linkedIssues.map((issue) => (
                  <div key={issue.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onNavigateToIssue?.(issue.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-elevated/60"
                    >
                      <span
                        className={clsx(
                          "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium",
                          issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
                        )}
                      >
                        #{issue.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-left text-sm text-fg-2">{issue.title}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleUnlink(issue.number)}
                      title="取消关联"
                      className="shrink-0 rounded p-0.5 text-fg-5 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(pr.commitCount != null || pr.additions != null) && (
            <div className="mb-6 rounded-lg border border-line bg-elevated/30 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3 text-xs text-fg-3">
                {pr.commitCount != null && (
                  <span className="flex items-center gap-1">
                    <GitCommit className="h-3.5 w-3.5 text-fg-5" />
                    <span className="font-medium">{pr.commitCount}</span> 次提交
                  </span>
                )}
                {pr.changedFilesCount != null && (
                  <span className="flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5 text-fg-5" />
                    <span className="font-medium">{pr.changedFilesCount}</span> 个文件
                  </span>
                )}
                {pr.additions != null && (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Plus className="h-3 w-3" />
                    <span className="font-mono font-medium">{pr.additions}</span>
                  </span>
                )}
                {pr.deletions != null && (
                  <span className="flex items-center gap-1 text-red-400">
                    <Minus className="h-3 w-3" />
                    <span className="font-mono font-medium">{pr.deletions}</span>
                  </span>
                )}
              </div>

              {pr.diffStats && pr.diffStats.length > 0 && (
                <div className="mt-3 border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => setFilesExpanded((v) => !v)}
                    className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-4 transition-colors hover:text-fg-2"
                  >
                    {filesExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    变更文件 ({pr.diffStats.length})
                  </button>
                  {filesExpanded && (
                    <div className="mt-2 space-y-0.5">
                      {pr.diffStats.map((f) => (
                        <div key={f.filename} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-elevated/50">
                          <span className={clsx(
                            "w-14 shrink-0 rounded px-1 py-0.5 text-center font-mono text-[10px] font-medium",
                            f.status === "added" ? "bg-emerald-500/15 text-emerald-400"
                              : f.status === "removed" ? "bg-red-500/15 text-red-400"
                              : "bg-blue-500/15 text-blue-400",
                          )}>
                            {f.status === "added" ? "新增" : f.status === "removed" ? "删除" : f.status === "renamed" ? "重命名" : "修改"}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-fg-3" title={f.filename}>{f.filename}</span>
                          <span className="shrink-0 font-mono text-[11px] text-emerald-400">+{f.additions}</span>
                          <span className="shrink-0 font-mono text-[11px] text-red-400">-{f.deletions}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {pr.body ? (
            <div className="markdown-body leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {pr.body}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="py-10 text-center font-mono text-xs text-fg-5">该 PR 没有描述内容</p>
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
                      <img src={c.user.avatar_url} alt={c.user.login} className="h-5 w-5 rounded-full" />
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
    </div>
  )
}

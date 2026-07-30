import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  AlertTriangle,
  ChevronLeft,
  CircleDot,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Link2,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"
import clsx from "clsx"
import { ApiError, listPrLinkedIssues, listPullComments, mergePull, updateIssue, type Issue, type IssueComment, type PersistentPullRequest } from "../lib/api-client"
import { usePrStore } from "../stores/pr-store"
import { useIssueStore } from "../stores/issue-store"
import { useRepoStore } from "../stores/repo-store"
import { useToastStore } from "../stores/toast-store"

type StateFilter = "open" | "closed" | "merged" | "all"

const STATE_FILTERS: { key: StateFilter; label: string }[] = [
  { key: "open", label: "开放" },
  { key: "merged", label: "已合并" },
  { key: "closed", label: "已关闭" },
  { key: "all", label: "全部" },
]

function relativeTime(ts: number): string {
  const ms = ts < 1_000_000_000_000 ? ts * 1000 : ts
  const diff = Date.now() - ms
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)}天前`
  const d = new Date(ms)
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
}

function stateColor(state: string) {
  if (state === "merged") return "bg-purple-500/15 text-purple-400"
  if (state === "closed") return "bg-red-500/15 text-red-400"
  return "bg-emerald-500/15 text-emerald-400"
}

function CompactPrRow({
  pr,
  isActive,
  onSelect,
}: {
  pr: PersistentPullRequest
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
            <span className={clsx("shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-medium", stateColor(pr.state))}>
              #{pr.number}
            </span>
            {pr.draft === 1 && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold bg-fg-6/15 text-fg-4">DRAFT</span>
            )}
            <span className="min-w-0 truncate text-sm font-medium text-fg-2">{pr.title}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-fg-6">
            {pr.headBranch} → {pr.baseBranch}
          </div>
        </div>
      </button>
    </li>
  )
}

function FullWidthPrRow({
  pr,
  onSelect,
}: {
  pr: PersistentPullRequest
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
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ring-1",
            pr.state === "merged"
              ? "bg-gradient-to-br from-purple-500/20 to-purple-500/5 text-purple-400 ring-purple-500/25"
              : pr.state === "closed"
                ? "bg-gradient-to-br from-red-500/20 to-red-500/5 text-red-400 ring-red-500/25"
                : "bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-emerald-400 ring-emerald-500/25",
          )}
        >
          {pr.number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {pr.draft === 1 && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide bg-fg-6/15 text-fg-4">DRAFT</span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-2 group-hover:text-fg">{pr.title}</span>
            {pr.mergeable === "false" && pr.state === "open" && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-400">
                <AlertTriangle className="inline h-3 w-3 -mt-px" /> Conflict
              </span>
            )}
            {pr.assignees && pr.assignees.length > 0 && (
              <div className="hidden shrink-0 items-center -space-x-1.5 sm:flex">
                {pr.assignees.slice(0, 3).map((a) => (
                  <img key={a.login} src={a.avatar_url} alt={a.login} title={a.login} className="h-5 w-5 rounded-full ring-2 ring-surface" />
                ))}
              </div>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="shrink-0 font-mono text-[11px] text-fg-5">{pr.headBranch} → {pr.baseBranch}</span>
            <span className="text-fg-6">·</span>
            {pr.authorLogin && (
              <>
                <span className="shrink-0 text-[11px] text-fg-5" title={pr.authorLogin}>
                  {pr.authorAvatar && <img src={pr.authorAvatar} alt="" className="mr-1 inline-block h-3.5 w-3.5 rounded-full align-text-bottom" />}
                  {pr.authorLogin}
                </span>
                <span className="text-fg-6">·</span>
              </>
            )}
            <span className="shrink-0 text-[11px] text-fg-6">{relativeTime(pr.createdAt)}</span>
            {pr.labels && pr.labels.length > 0 && (
              <>
                <span className="text-fg-6">·</span>
                {pr.labels.map((l) => (
                  <span
                    key={l.id}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: `#${l.color}20`, color: `#${l.color}` }}
                  >
                    {l.name}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
      </button>
    </li>
  )
}

function IssueMatchRow({
  issue,
  linked,
  onToggle,
}: {
  issue: Issue
  linked: boolean
  onToggle: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={clsx(
          "group flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left transition-colors",
          linked
            ? "border-l-2 border-emerald-500 bg-emerald-500/5"
            : "border-l-2 border-transparent hover:bg-elevated/50",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={clsx(
                "shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-medium",
                issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
              )}
            >
              #{issue.number}
            </span>
            <span className="min-w-0 truncate text-sm font-medium text-fg-2">{issue.title}</span>
            {linked && <Link2 className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-400" />}
          </div>
        </div>
      </button>
    </li>
  )
}

function PrDetail({
  pr,
  onBack,
  onClose,
  onEnterMatch,
}: {
  pr: PersistentPullRequest
  onBack?: () => void
  onClose?: () => void
  onEnterMatch: () => void
}) {
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const [merging, setMerging] = useState(false)
  const [comments, setComments] = useState<IssueComment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [linkedIssues, setLinkedIssues] = useState<Issue[]>([])
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
              <span className={clsx("shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold", stateColor(pr.state))}>
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
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: `#${l.color}20`, color: `#${l.color}` }}
                >
                  {l.name}
                </span>
              ))}
            </div>
            <h2 className="mt-1 text-base font-semibold text-fg">{pr.title}</h2>
            <div className="mt-1.5 flex items-center gap-3 text-xs text-fg-4">
              <span className="flex items-center gap-1 font-mono text-[11px] text-fg-5">
                <GitPullRequest className="h-3.5 w-3.5" />
                {pr.headBranch} → {pr.baseBranch}
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
              源站
            </a>
          )}
          <button
            type="button"
            onClick={onEnterMatch}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-fg-3 transition-colors hover:border-blue-500/50 hover:text-blue-400"
          >
            <Link2 className="h-3.5 w-3.5" />
            关联 Issue
          </button>
          {pr.state === "open" && (
            <>
              <button
                type="button"
                disabled={merging || pr.mergeable === "false"}
                onClick={() => void handleMerge(false)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/30 px-2.5 text-xs font-medium text-emerald-400 transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/10 disabled:opacity-40"
              >
                <GitMerge className="h-3.5 w-3.5" />
                合入
              </button>
              {linkedIssues.some((i) => i.state === "open") && (
                <button
                  type="button"
                  disabled={merging || pr.mergeable === "false"}
                  onClick={() => void handleMerge(true)}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
                >
                  <GitMerge className="h-3.5 w-3.5" />
                  合入并关闭 Issues
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
                      onClick={() => navigate(`/${activeRepoId}/issues?issueId=${encodeURIComponent(issue.id)}`)}
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

export function PullRequestsPage() {
  const [stateFilter, setStateFilter] = useState<StateFilter>("open")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [issueSearchQuery, setIssueSearchQuery] = useState("")
  const [searchParams, setSearchParams] = useSearchParams()

  const pulls = usePrStore((s) => s.pulls)
  const syncing = usePrStore((s) => s.syncing)
  const syncPulls = usePrStore((s) => s.syncPulls)
  const matchingPrId = usePrStore((s) => s.matchingPrId)
  const enterMatchMode = usePrStore((s) => s.enterMatchMode)
  const exitMatchMode = usePrStore((s) => s.exitMatchMode)
  const linkIssue = usePrStore((s) => s.linkIssue)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const allIssues = useIssueStore((s) => s.issues)

  useEffect(() => {
    const paramId = searchParams.get("prId")
    if (paramId && pulls.some((p) => p.id === paramId)) {
      setSelectedId(paramId)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams, pulls])

  const matchingPr = matchingPrId ? pulls.find((p) => p.id === matchingPrId) ?? null : null

  const [linkedIssueIds, setLinkedIssueIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!activeRepoId || !matchingPr) {
      setLinkedIssueIds(new Set())
      return
    }
    listPrLinkedIssues(activeRepoId, matchingPr.number)
      .then((linked) => setLinkedIssueIds(new Set(linked.map((i) => i.id))))
      .catch(() => setLinkedIssueIds(new Set()))
  }, [activeRepoId, matchingPr])

  const handleToggleLink = async (issue: Issue) => {
    if (!matchingPr) return
    const isLinked = linkedIssueIds.has(issue.id)
    if (isLinked) {
      const ok = await usePrStore.getState().unlinkIssue(matchingPr.number, issue.number)
      if (ok) setLinkedIssueIds((prev) => { const next = new Set(prev); next.delete(issue.id); return next })
    } else {
      const ok = await linkIssue(matchingPr.number, issue.number)
      if (ok) setLinkedIssueIds((prev) => new Set(prev).add(issue.id))
    }
  }

  const openCount = pulls.filter((p) => p.state === "open").length
  const mergedCount = pulls.filter((p) => p.state === "merged").length
  const closedCount = pulls.filter((p) => p.state === "closed").length

  const afterState = stateFilter === "all" ? pulls : pulls.filter((p) => p.state === stateFilter)
  const sq = searchQuery.trim().toLowerCase()
  const filtered = !sq
    ? afterState
    : afterState.filter((p) => `#${p.number} ${p.title} ${p.headBranch} ${p.baseBranch}`.toLowerCase().includes(sq))

  const isq = issueSearchQuery.trim().toLowerCase()
  const filteredIssues = !isq
    ? allIssues
    : allIssues.filter((i) => `#${i.number} ${i.title}`.toLowerCase().includes(isq))

  const selectedPr = pulls.find((p) => p.id === selectedId) ?? null
  const showDetail = matchingPr ?? selectedPr

  return (
    <div className="flex min-h-0 flex-1">
      <div
        className={clsx(
          "shrink-0 flex-col bg-surface",
          showDetail
            ? "hidden md:flex md:w-80 border-r border-line"
            : "flex w-full",
        )}
      >
        {matchingPrId ? (
          <>
            <div className="flex items-center justify-between border-b border-line px-3 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">选择 Issue 关联</span>
              <button
                type="button"
                onClick={exitMatchMode}
                className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
              >
                <X className="h-3.5 w-3.5" />
                完成
              </button>
            </div>
            <div className="border-b border-line px-3 py-2">
              <div className="flex items-center gap-2 rounded-md border border-line bg-base px-2 py-1">
                <Search className="h-3.5 w-3.5 shrink-0 text-fg-5" />
                <input
                  type="text"
                  value={issueSearchQuery}
                  onChange={(e) => setIssueSearchQuery(e.target.value)}
                  placeholder="搜索 issue..."
                  className="min-w-0 flex-1 bg-transparent font-mono text-xs text-fg placeholder:text-fg-6 focus:outline-none"
                />
                {issueSearchQuery && (
                  <button type="button" onClick={() => setIssueSearchQuery("")} className="shrink-0 text-fg-5 hover:text-fg-3">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {filteredIssues.length === 0 ? (
                <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">
                  {allIssues.length === 0 ? "暂无 Issue，请先同步" : "无匹配 Issue"}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {filteredIssues.map((issue) => (
                    <IssueMatchRow
                      key={issue.id}
                      issue={issue}
                      linked={linkedIssueIds.has(issue.id)}
                      onToggle={() => void handleToggleLink(issue)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : !showDetail ? (
          <>
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="shrink-0 text-sm font-semibold text-fg">Pull Requests</span>
              <div className="flex shrink-0 items-center rounded-lg bg-elevated/60 p-0.5">
                {STATE_FILTERS.map(({ key, label }) => {
                  const count = key === "open" ? openCount : key === "merged" ? mergedCount : key === "closed" ? closedCount : pulls.length
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
              <div className="min-w-0 flex-1 px-1">
                <div className="flex items-center gap-2 rounded-md border border-line bg-base px-2.5 py-1.5">
                  <Search className="h-3.5 w-3.5 shrink-0 text-fg-5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索 PR..."
                    className="min-w-0 flex-1 bg-transparent text-xs text-fg placeholder:text-fg-6 focus:outline-none"
                  />
                  {searchQuery && (
                    <button type="button" onClick={() => setSearchQuery("")} className="shrink-0 text-fg-5 hover:text-fg-3">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void syncPulls()}
                disabled={syncing || !activeRepoId}
                title="同步 PR"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-2 disabled:opacity-40"
              >
                <RefreshCw className={clsx("h-4 w-4", syncing && "animate-spin")} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-line px-3 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-fg-3">Pull Requests</span>
              {activeRepoId && (
                <button
                  type="button"
                  onClick={() => void syncPulls()}
                  disabled={syncing}
                  title="同步"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2 disabled:opacity-40"
                >
                  <RefreshCw className={clsx("h-3.5 w-3.5", syncing && "animate-spin")} />
                </button>
              )}
            </div>
            <div className="flex border-b border-line">
              {STATE_FILTERS.map(({ key, label }) => {
                const count = key === "open" ? openCount : key === "merged" ? mergedCount : key === "closed" ? closedCount : pulls.length
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
                  placeholder="搜索 PR..."
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

        {!matchingPrId && (
          <div className={clsx("flex-1 overflow-y-auto", showDetail ? "px-2 py-2" : "px-3 py-3")}>
            {!activeRepoId ? (
              <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">请先选择一个仓库</p>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-fg-5">
                <GitPullRequest className="h-8 w-8" />
                <p className="font-mono text-xs">{pulls.length === 0 ? "点击 ↻ 同步 PR" : "没有匹配的 PR"}</p>
              </div>
            ) : (
              <ul className={clsx(showDetail ? "space-y-0.5" : "space-y-1")}>
                {filtered.map((pr) =>
                  showDetail ? (
                    <CompactPrRow
                      key={pr.id}
                      pr={pr}
                      isActive={pr.id === (selectedId ?? matchingPrId)}
                      onSelect={() => setSelectedId(pr.id)}
                    />
                  ) : (
                    <FullWidthPrRow
                      key={pr.id}
                      pr={pr}
                      onSelect={() => setSelectedId(pr.id)}
                    />
                  ),
                )}
              </ul>
            )}
          </div>
        )}
      </div>

      {showDetail ? (
        <PrDetail
          key={`${showDetail.id}-${matchingPrId ?? "view"}`}
          pr={showDetail}
          onBack={() => { setSelectedId(null); if (matchingPrId) exitMatchMode() }}
          onClose={() => { setSelectedId(null); if (matchingPrId) exitMatchMode() }}
          onEnterMatch={() => enterMatchMode(showDetail.id)}
        />
      ) : (
        <div className="hidden flex-1 items-center justify-center md:flex">
          <div className="text-center text-fg-5">
            <GitPullRequest className="mx-auto h-12 w-12 opacity-20" />
            <p className="mt-3 font-mono text-xs">选择一个 PR 查看详情</p>
          </div>
        </div>
      )}
    </div>
  )
}

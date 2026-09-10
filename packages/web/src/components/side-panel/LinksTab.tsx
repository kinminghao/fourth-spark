import { useState, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useRepoStore, selectActiveRepoName } from "../../stores/repo-store"
import clsx from "clsx"
import { Link2, Plus, X, Search } from "lucide-react"
import type { SessionLinks } from "../../lib/api-client"
import { useIssueStore } from "../../stores/issue-store"
import { usePrStore } from "../../stores/pr-store"
import { useSessionStore } from "../../stores/session-store"

function LinkMatchRow({
  linked,
  number,
  title,
  state,
  mergedAt,
  isPr,
  onToggle,
}: {
  linked: boolean
  number: number
  title: string
  state: string
  mergedAt?: number | null
  isPr?: boolean
  onToggle: () => void
}) {
  const badgeColor = isPr
    ? state === "open" ? "bg-emerald-500/15 text-emerald-400"
      : mergedAt ? "bg-purple-500/15 text-purple-400"
      : "bg-red-500/15 text-red-400"
    : state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400"

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={clsx(
          "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
          linked
            ? "border-l-2 border-emerald-500 bg-emerald-500/5"
            : "border-l-2 border-transparent hover:bg-elevated/50",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className={clsx("shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-semibold", badgeColor)}>
            #{number}
          </span>
          <span className="min-w-0 truncate text-xs text-fg-2">{title}</span>
          {linked && <Link2 className="ml-auto h-3 w-3 shrink-0 text-emerald-400" />}
        </div>
      </button>
    </li>
  )
}

type MatchMode = null | "issue" | "pr"

export function LinksTab({ links, sessionId }: { links?: SessionLinks; sessionId: string | null }) {
  const navigate = useNavigate()
  const repoName = useRepoStore(selectActiveRepoName)
  const [matchMode, setMatchMode] = useState<MatchMode>(null)
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const allIssues = useIssueStore((s) => s.issues)
  const allPrs = usePrStore((s) => s.pulls)
  const addLink = useSessionStore((s) => s.addLink)
  const removeLink = useSessionStore((s) => s.removeLink)

  const linkedIssueIds = new Set(links?.issues?.map((i) => i.id) ?? [])
  const linkedPrIds = new Set(links?.pullRequests?.map((p) => p.id) ?? [])

  useEffect(() => {
    if (matchMode) inputRef.current?.focus()
  }, [matchMode])

  const exitMatch = () => { setMatchMode(null); setQuery("") }

  const handleToggle = async (type: "issue" | "pr", targetId: string, isLinked: boolean) => {
    if (!sessionId) return
    if (isLinked) {
      await removeLink(sessionId, type, targetId)
    } else {
      await addLink(sessionId, type, targetId)
    }
  }

  const q = query.trim().toLowerCase()
  const filteredIssues = !q
    ? allIssues
    : allIssues.filter((i) => `#${i.number} ${i.title}`.toLowerCase().includes(q))
  const filteredPrs = !q
    ? allPrs
    : allPrs.filter((p) => `#${p.number} ${p.title} ${p.headBranch}`.toLowerCase().includes(q))

  const issueCount = links?.issues?.length ?? 0
  const prCount = links?.pullRequests?.length ?? 0

  if (matchMode) {
    const isIssueMode = matchMode === "issue"
    const items = isIssueMode ? filteredIssues : filteredPrs
    const linkedIds = isIssueMode ? linkedIssueIds : linkedPrIds

    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">
            {isIssueMode ? "关联 Issue" : "关联 PR"}
          </span>
          <button
            type="button"
            onClick={exitMatch}
            className="flex h-6 items-center gap-1 rounded-md px-2 text-xs text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
          >
            <X className="h-3.5 w-3.5" />
            完成
          </button>
        </div>
        <div className="border-b border-line px-3 py-2">
          <div className="flex items-center gap-2 rounded-md border border-line bg-base px-2 py-1">
            <Search className="h-3.5 w-3.5 shrink-0 text-fg-5" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={isIssueMode ? "搜索 issue..." : "搜索 PR..."}
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-fg placeholder:text-fg-6 focus:outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="shrink-0 text-fg-5 hover:text-fg-3">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {items.length === 0 ? (
            <p className="px-2 py-8 text-center font-mono text-xs text-fg-5">
              {(isIssueMode ? allIssues : allPrs).length === 0
                ? (isIssueMode ? "暂无 Issue，请先同步" : "暂无 PR，请先同步")
                : "无匹配结果"}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {items.map((item) => (
                <LinkMatchRow
                  key={item.id}
                  linked={linkedIds.has(item.id)}
                  number={item.number}
                  title={item.title}
                  state={item.state}
                  mergedAt={isIssueMode ? undefined : (item as typeof allPrs[number]).mergedAt}
                  isPr={!isIssueMode}
                  onToggle={() => handleToggle(matchMode, item.id, linkedIds.has(item.id))}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="flex-1 font-mono text-[10px] text-fg-5">
          {issueCount + prCount > 0 ? `${issueCount + prCount} 项关联` : "暂无关联"}
        </span>
        <button
          type="button"
          onClick={() => setMatchMode("issue")}
          className="flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-fg-4 transition-colors hover:border-emerald-500/50 hover:text-emerald-400"
        >
          <Plus className="h-3 w-3" />
          <span className="text-[10px] font-medium">Issue</span>
        </button>
        <button
          type="button"
          onClick={() => setMatchMode("pr")}
          className="flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-fg-4 transition-colors hover:border-blue-500/50 hover:text-blue-400"
        >
          <Plus className="h-3 w-3" />
          <span className="text-[10px] font-medium">PR</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {issueCount > 0 && (
          <div className="mb-3">
            <div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-5">
              Issues ({issueCount})
            </div>
            <ul className="space-y-1">
              {links!.issues.map((issue) => (
                <li key={issue.id} className="group flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/${encodeURIComponent(repoName!)}/dev/issues?id=${encodeURIComponent(issue.id)}`)}
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-elevated/60"
                  >
                    <span className={clsx(
                      "mt-0.5 shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-semibold",
                      issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
                    )}>
                      #{issue.number}
                    </span>
                    <span className="line-clamp-2 text-xs leading-5 text-fg-3 group-hover:text-fg-2">
                      {issue.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggle("issue", issue.id, true)}
                    className="mt-1.5 hidden shrink-0 rounded p-0.5 text-fg-5 transition-colors hover:bg-red-500/15 hover:text-red-400 group-hover:block"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {prCount > 0 && (
          <div>
            <div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-5">
              Pull Requests ({prCount})
            </div>
            <ul className="space-y-1">
              {links!.pullRequests.map((pr) => (
                <li key={pr.id} className="group flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/${encodeURIComponent(repoName!)}/dev/pulls?id=${encodeURIComponent(pr.id)}`)}
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-elevated/60"
                  >
                    <span className={clsx(
                      "mt-0.5 shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-semibold",
                      pr.state === "open" ? "bg-emerald-500/15 text-emerald-400"
                        : pr.mergedAt ? "bg-purple-500/15 text-purple-400"
                        : "bg-red-500/15 text-red-400",
                    )}>
                      #{pr.number}
                    </span>
                    <span className="line-clamp-2 text-xs leading-5 text-fg-3 group-hover:text-fg-2">
                      {pr.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggle("pr", pr.id, true)}
                    className="mt-1.5 hidden shrink-0 rounded p-0.5 text-fg-5 transition-colors hover:bg-red-500/15 hover:text-red-400 group-hover:block"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {issueCount === 0 && prCount === 0 && (
          <div className="flex flex-1 items-center justify-center py-10">
            <p className="font-mono text-xs text-fg-5">点击上方按钮添加关联</p>
          </div>
        )}
      </div>
    </div>
  )
}

import { useState } from "react"
import { Check, Menu, X } from "lucide-react"
import clsx from "clsx"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useIssueStore } from "../../stores/issue-store"

function IssueBody({ body }: { body?: string }) {
  if (!body) return <p className="py-10 text-center font-mono text-xs text-fg-5">该 Issue 没有描述内容</p>
  return (
    <div className="markdown-body leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  )
}

function IssueHeader({ issue }: { issue: { number: number; title: string; state: string; labels?: Array<{ id: number; name: string; color: string }> } }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className={clsx(
          "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
          issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
        )}>
          #{issue.number} {issue.state}
        </span>
        {issue.labels?.map((l) => (
          <span key={l.id} className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `#${l.color}20`, color: `#${l.color}` }}>
            {l.name}
          </span>
        ))}
      </div>
      <h2 className="mt-0.5 truncate text-sm font-medium text-fg">{issue.title}</h2>
    </div>
  )
}

export function IssueMatchView({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const parentId = useIssueStore((s) => s.matchingParentId)
  const candidateId = useIssueStore((s) => s.matchingCandidateId)
  const parent = useIssueStore((s) => s.issues.find((i) => i.id === parentId))
  const candidate = useIssueStore((s) => s.issues.find((i) => i.id === candidateId))
  const exitMatchMode = useIssueStore((s) => s.exitMatchMode)
  const linkChild = useIssueStore((s) => s.linkChild)
  const [linking, setLinking] = useState(false)

  if (!parent) return null

  const handleConfirm = async () => {
    if (!candidate) return
    setLinking(true)
    await linkChild(parent.number, candidate.number)
    setLinking(false)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-term">
      <header className="flex items-center gap-3 border-b border-line bg-base px-4 py-2.5">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Open sidebar"
          className="-ml-1 rounded-lg p-1.5 text-fg-3 hover:bg-elevated md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-xs font-medium text-fg-4">匹配子任务</span>
        <span className="font-mono text-xs text-fg-3">父: #{parent.number}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={exitMatchMode}
          className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-fg-3 transition-colors hover:border-fg-5 hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
          退出匹配
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-line md:border-b-0 md:border-r">
          <div className="border-b border-line/60 px-4 py-2.5">
            <IssueHeader issue={parent} />
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <IssueBody body={parent.body} />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {candidate ? (
            <>
              <div className="border-b border-line/60 px-4 py-2.5">
                <IssueHeader issue={candidate} />
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-6">
                <IssueBody body={candidate.body} />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="font-mono text-xs text-fg-5">← 从左侧列表选择候选 Issue</p>
            </div>
          )}
        </div>
      </div>

      {candidate && (
        <div className="flex items-center justify-center gap-3 border-t border-line bg-base px-4 py-3">
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={linking}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {linking ? "关联中…" : `确认: 将 #${candidate.number} 设为 #${parent.number} 的子任务`}
          </button>
        </div>
      )}
    </div>
  )
}

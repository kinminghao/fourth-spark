import { Network } from "lucide-react"
import clsx from "clsx"
import type { Issue, Session } from "../lib/api-client"
import { SidebarSessionList } from "./SessionSidebar"

export function TreeNode({
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

export function countDescendants(
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

export function IssueTreeSidebar({
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

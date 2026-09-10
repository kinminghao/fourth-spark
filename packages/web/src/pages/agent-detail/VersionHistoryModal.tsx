import { X } from "lucide-react"
import clsx from "clsx"
import type { AgentMemory } from "../../lib/api-client"
import { formatRelativeTime, VERSION_ACTION_LABELS } from "./agent-utils"

export function VersionHistoryModal({ memory, onClose }: {
  memory: AgentMemory
  onClose: () => void
}) {
  const versions = [...(memory.history ?? [])].reverse()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">版本历史 ({versions.length + 1} 个版本)</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-fg-4 hover:text-fg-3">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
            <div className="mb-1 flex items-center gap-2 text-[10px]">
              <span className="font-medium text-blue-400">当前版本</span>
              <span className="text-fg-5">{formatRelativeTime(memory.updatedAt)}</span>
              <span className="text-fg-6">⚡ {memory.importance.toFixed(2)}</span>
            </div>
            <p className="text-xs leading-relaxed text-fg">{memory.content}</p>
          </div>

          {versions.map((v, i) => {
            const style = VERSION_ACTION_LABELS[v.action] ?? { label: v.action, color: "text-fg-4" }
            return (
              <div key={i} className="rounded-lg border border-line bg-base p-3">
                <div className="mb-1 flex items-center gap-2 text-[10px]">
                  <span className={clsx("font-medium", style.color)}>{style.label}</span>
                  <span className="text-fg-5">{formatRelativeTime(v.ts)}</span>
                  <span className="text-fg-6">⚡ {v.importance.toFixed(2)}</span>
                  {v.source && <span className="text-fg-6">· {v.source}</span>}
                </div>
                <p className="text-xs leading-relaxed text-fg-4">{v.content}</p>
              </div>
            )
          })}

          {versions.length === 0 && (
            <div className="py-4 text-center text-xs text-fg-5">暂无历史版本</div>
          )}
        </div>
      </div>
    </div>
  )
}

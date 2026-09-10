import { useState } from "react"
import { Check, Edit3, Trash2, X, Zap } from "lucide-react"
import clsx from "clsx"
import type { AgentMemory } from "../../lib/api-client"
import { getCategoryStyle, formatRelativeTime, VERSION_ACTION_LABELS } from "./agent-utils"
import { VersionHistoryModal } from "./VersionHistoryModal"

export function MemoryItem({ memory, categories, onUpdate, onDelete }: {
  memory: AgentMemory
  categories: string[]
  onUpdate: (memId: string, data: { content?: string; category?: string; importance?: number }) => Promise<void>
  onDelete: (memId: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(memory.content)
  const [category, setCategory] = useState(memory.category)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const style = getCategoryStyle(memory.category)
  const lastVersion = memory.history?.[memory.history.length - 1]
  const impChanged = lastVersion && Math.abs(lastVersion.importance - memory.importance) > 0.001

  const handleSave = async () => {
    setSaving(true)
    try {
      await onUpdate(memory.id, { content, category })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(false)
    await onDelete(memory.id)
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3}
          className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none" />
        <div className="flex items-center gap-3">
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg focus:border-blue-500 focus:outline-none">
            {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
          <div className="flex-1" />
          <button type="button" onClick={() => { setEditing(false); setContent(memory.content); setCategory(memory.category) }}
            className="rounded-md px-3 py-1 text-xs text-fg-4 hover:bg-elevated">取消</button>
          <button type="button" onClick={() => void handleSave()} disabled={saving || !content.trim()}
            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40">
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="group/mem rounded-lg border border-line bg-base px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className={clsx("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", style.bg, style.text)}>
          {memory.category}
        </span>
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-fg">{memory.content}</p>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-fg-5">
        <span className="flex items-center gap-0.5">
          <Zap className="h-3 w-3" />
          {impChanged && lastVersion
            ? `${lastVersion.importance.toFixed(2)}→${memory.importance.toFixed(2)}`
            : memory.importance.toFixed(2)}
        </span>
        <span>·</span>
        <span>{formatRelativeTime(memory.updatedAt)}</span>
        {memory.supersededBy && (
          <>
            <span>·</span>
            <span className="text-amber-400">{memory.supersededBy === "user-deleted" ? "已删除" : memory.supersededBy === "consolidated-out" ? "已整理" : "已合并"}</span>
          </>
        )}
        {memory.history && memory.history.length > 0 && (() => {
          const latest = memory.history[memory.history.length - 1]
          const versionStyle = VERSION_ACTION_LABELS[latest.action]
          return (
            <button type="button" onClick={() => setShowHistory(true)}
              data-guide={memory.id === "guide-mem-1" ? "agent-memory-version" : undefined}
              className={clsx("rounded px-1.5 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-80",
                latest.action === "update" ? "bg-blue-500/10 text-blue-400" :
                latest.action === "merge" ? "bg-purple-500/10 text-purple-400" :
                latest.action === "decay" ? "bg-amber-500/10 text-amber-400" :
                latest.action === "reinforce" ? "bg-emerald-500/10 text-emerald-400" :
                latest.action === "manual" ? "bg-fg/10 text-fg-3" :
                "bg-green-500/10 text-green-400"
              )}>
              {versionStyle?.label ?? latest.action} · {memory.history.length}版
            </button>
          )
        })()}
        <div className="flex-1" />
        {!memory.supersededBy && (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/mem:opacity-100">
            {deleting ? (
              <>
                <button type="button" onClick={() => void handleDelete()} className="rounded p-1 text-red-400 hover:bg-red-500/10">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setDeleting(false)} className="rounded p-1 text-fg-4 hover:bg-elevated">
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setEditing(true)} className="rounded p-1 text-fg-5 hover:text-fg-3">
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setDeleting(true)} className="rounded p-1 text-fg-5 hover:text-red-400">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {showHistory && <VersionHistoryModal memory={memory} onClose={() => setShowHistory(false)} />}
    </div>
  )
}

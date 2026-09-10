import { useCallback, useEffect, useMemo, useState } from "react"
import { Brain, Check, Clock, Edit3, Loader2, Trash2, X, Zap } from "lucide-react"
import clsx from "clsx"
import * as api from "../../lib/api-client"
import type { AgentMemory, AgentSession, ConsolidationStats } from "../../lib/api-client"
import { GUIDE_AGENT_PREFIX, MOCK_MEMORIES } from "../../components/guide-mock-data"
import {
  CATEGORY_PALETTE,
  CATEGORY_STYLE_GENERAL,
  getCategoryStyle,
  formatRelativeTime,
  VERSION_ACTION_LABELS,
} from "./agent-utils"

// ---------------------------------------------------------------------------
// VersionHistoryModal
// ---------------------------------------------------------------------------

function VersionHistoryModal({ memory, onClose }: {
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

// ---------------------------------------------------------------------------
// MemoryItem
// ---------------------------------------------------------------------------

function MemoryItem({ memory, categories, onUpdate, onDelete }: {
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

// ---------------------------------------------------------------------------
// ConsolidationStatsBar
// ---------------------------------------------------------------------------

const CONSOLIDATION_INTERVAL_MS = 4 * 60 * 60 * 1_000

function formatNextRun(lastConsolidatedAt: number | null): string {
  if (!lastConsolidatedAt) return "下次：待定"
  const nextRun = lastConsolidatedAt + CONSOLIDATION_INTERVAL_MS
  const now = Date.now()
  if (nextRun <= now) return "下次：即将运行"
  const diff = nextRun - now
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `下次：约 ${mins} 分钟后`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `下次：约 ${hours} 小时后`
  return `下次：约 ${Math.floor(hours / 24)} 天后`
}

function ConsolidationStatsBar({ stats, running, onTrigger }: {
  stats: ConsolidationStats | null
  running: boolean
  onTrigger: () => void
}) {
  if (!stats) return null

  const a = stats.lastActions

  return (
    <div className="rounded-lg bg-elevated px-3 py-2 text-[11px] tabular-nums text-fg-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          {stats.lastConsolidatedAt
            ? `上次整理：${formatRelativeTime(stats.lastConsolidatedAt)}`
            : "尚未整理"}
        </span>
        <span className="text-fg-6">·</span>
        <span>{formatNextRun(stats.lastConsolidatedAt)}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onTrigger}
          disabled={running}
          className="rounded px-2 py-0.5 text-[10px] font-medium text-fg-4 transition-colors hover:bg-surface hover:text-fg-3 disabled:opacity-40"
        >
          {running ? "整理中…" : "立即整理"}
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {a && (
          <>
            <span>{a.update} 更新 {a.merge} 合并 {a.delete} 清理 {a.decayed} 降权</span>
            <span className="text-fg-6">·</span>
          </>
        )}
        <span>活跃 {stats.totalActive} 条</span>
        <span className="text-fg-6">·</span>
        <span>衰减中 {stats.stale}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MemorySection
// ---------------------------------------------------------------------------

export function MemorySection({ agentId }: { agentId: string }) {
  const isMockAgent = agentId.startsWith(GUIDE_AGENT_PREFIX)
  const [memories, setMemories] = useState<AgentMemory[]>(isMockAgent ? MOCK_MEMORIES : [])
  const [loading, setLoading] = useState(!isMockAgent)
  const [filter, setFilter] = useState<string | null>(null)
  const [showSuperseded, setShowSuperseded] = useState(false)
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [showSessions, setShowSessions] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [extracting, setExtracting] = useState(false)
  const [extractResult, setExtractResult] = useState<string | null>(null)
  const [consolidationStats, setConsolidationStats] = useState<ConsolidationStats | null>(null)
  const [consolidationRunning, setConsolidationRunning] = useState(false)

  const load = useCallback(async () => {
    if (isMockAgent) { setMemories(MOCK_MEMORIES); setLoading(false); return }
    setLoading(true)
    try {
      const data = await api.listAgentMemories(agentId, {
        includeSuperseded: showSuperseded,
      })
      setMemories(data)
    } catch {
      setMemories([])
    }
    setLoading(false)
  }, [agentId, showSuperseded, isMockAgent])

  const loadStats = useCallback(() => {
    if (isMockAgent) return
    api.getMemoryConsolidationStats(agentId)
      .then(setConsolidationStats)
      .catch(() => setConsolidationStats(null))
  }, [agentId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { loadStats() }, [loadStats])

  const handleTriggerConsolidation = async () => {
    setConsolidationRunning(true)
    try {
      await api.triggerConsolidation(agentId)
    } catch {
      setConsolidationRunning(false)
      return
    }
    const pollInterval = setInterval(() => {
      api.getMemoryConsolidationStats(agentId).then((s) => {
        setConsolidationStats(s)
        if (s.lastConsolidatedAt && (!consolidationStats?.lastConsolidatedAt || s.lastConsolidatedAt > consolidationStats.lastConsolidatedAt)) {
          clearInterval(pollInterval)
          setConsolidationRunning(false)
          void load()
        }
      }).catch(() => {})
    }, 5_000)
    setTimeout(() => { clearInterval(pollInterval); setConsolidationRunning(false) }, 300_000)
  }

  useEffect(() => {
    if (!showSessions) return
    let cancelled = false
    setSessionsLoading(true)
    api.listAgentSessions(agentId)
      .then(data => { if (!cancelled) setSessions(data) })
      .catch(() => { if (!cancelled) setSessions([]) })
      .finally(() => { if (!cancelled) setSessionsLoading(false) })
    return () => { cancelled = true }
  }, [agentId, showSessions])

  const allActive = memories.filter(m => !m.supersededBy)
  const active = filter ? allActive.filter(m => m.category === filter) : allActive
  const superseded = memories.filter(m => m.supersededBy)
  const extractedSessionIds = useMemo(() => new Set(memories.map(m => m.sessionId).filter(Boolean)), [memories])

  const handleUpdate = async (memId: string, data: { content?: string; category?: string; importance?: number }) => {
    await api.updateAgentMemory(agentId, memId, data)
    await load()
  }

  const handleDelete = async (memId: string) => {
    await api.deleteAgentMemory(agentId, memId)
    await load()
  }

  const toggleSession = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleExtract = async () => {
    if (selected.size === 0) return
    setExtracting(true)
    setExtractResult(null)
    try {
      const res = await api.extractAgentMemories(agentId, [...selected])
      const r = res as Record<string, unknown>
      const results = r.results as Array<{ sessionId: string; status: string; actions?: number; error?: string }>
      if (results) {
        const ok = results.filter(x => x.status === "ok")
        const failed = results.filter(x => x.status !== "ok")
        if (ok.length > 0) setExtractResult(`提取成功 ${ok.reduce((s, x) => s + (x.actions ?? 0), 0)} 条记忆`)
        if (failed.length > 0) setExtractResult(prev => (prev ? prev + "；" : "") + failed.map(x => x.error ?? x.status).join("；"))
        if (ok.length > 0) await load()
      }
      setSelected(new Set())
    } catch (err) {
      setExtractResult(`请求失败: ${err instanceof Error ? err.message : String(err)}`)
    }
    setExtracting(false)
  }

  const categories = useMemo(() => {
    const cats = new Set(allActive.map(m => m.category))
    return [...cats].sort()
  }, [allActive])

  return (
    <section data-guide="agent-memory-section" className="rounded-xl border border-line bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-400" />
          <h2 className="text-sm font-semibold text-fg">记忆</h2>
          {!loading && <span className="rounded-full bg-elevated px-1.5 py-0.5 text-[10px] tabular-nums text-fg-4">{active.length}</span>}
        </div>
      </div>

      <ConsolidationStatsBar
        stats={consolidationStats}
        running={consolidationRunning}
        onTrigger={() => void handleTriggerConsolidation()}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setFilter(null)}
          className={clsx("rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
            filter === null ? "bg-fg/10 text-fg" : "text-fg-4 hover:text-fg-3")}>
          全部
        </button>
        {categories.map(cat => {
          const s = getCategoryStyle(cat)
          return (
            <button key={cat} type="button" onClick={() => setFilter(filter === cat ? null : cat)}
              className={clsx("rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                filter === cat ? clsx(s.bg, s.text) : "text-fg-4 hover:text-fg-3")}>
              {cat}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 fs-spin text-fg-5" />
        </div>
      ) : active.length === 0 && superseded.length === 0 ? (
        <div className="py-8 text-center text-xs text-fg-5">
          暂无记忆。使用此 Agent 完成 Session 后将自动提取。
        </div>
      ) : (
        <div className="space-y-1.5">
          {active.map(m => (
            <MemoryItem
              key={m.id}
              memory={m}
              categories={categories}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
          {superseded.length > 0 && (
            <div className="pt-1">
              <button type="button" onClick={() => setShowSuperseded(!showSuperseded)}
                className="flex items-center gap-1 text-[11px] text-fg-5 hover:text-fg-3">
                <span>{showSuperseded ? "▾" : "▸"}</span>
                已合并/已删除 ({superseded.length})
              </button>
              {showSuperseded && (
                <div className="mt-1.5 space-y-1.5 opacity-60">
                  {superseded.map(m => (
                    <MemoryItem
                      key={m.id}
                      memory={m}
                      categories={categories}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-line pt-3">
        <button type="button" onClick={() => setShowSessions(!showSessions)}
          className="flex items-center gap-1.5 text-xs font-medium text-fg-4 hover:text-fg-3">
          <Clock className="h-3.5 w-3.5" />
          <span>{showSessions ? "▾" : "▸"} 从 Session 提取记忆</span>
        </button>

        {showSessions && (
          <div className="mt-2 space-y-1.5">
            {sessionsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 fs-spin text-fg-5" />
              </div>
            ) : sessions.length === 0 ? (
              <p className="py-4 text-center text-xs text-fg-5">暂无 Session 记录。</p>
            ) : (
              <>
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {sessions.map(s => {
                    const extracted = extractedSessionIds.has(s.id)
                    return (
                      <label key={s.id}
                        className={clsx("flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 transition-colors",
                          selected.has(s.id) ? "border-purple-500/30 bg-purple-500/5" : "border-line bg-base hover:bg-elevated/60")}>
                        <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSession(s.id)}
                          className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-line accent-purple-500" />
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-fg">{s.title || s.id.slice(-8)}</span>
                          <span className="text-[11px] text-fg-5">{formatRelativeTime(s.timeCreated)}</span>
                        </div>
                        <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          extracted ? "bg-green-500/10 text-green-400" : "bg-elevated text-fg-5")}>
                          {extracted ? "已提取" : "未提取"}
                        </span>
                      </label>
                    )
                  })}
                </div>
                {selected.size > 0 && (
                  <button type="button" onClick={() => void handleExtract()} disabled={extracting}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-purple-600 py-2 text-xs font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-40">
                    {extracting ? <Loader2 className="h-3.5 w-3.5 fs-spin" /> : <Brain className="h-3.5 w-3.5" />}
                    {extracting ? "提取中…" : `提取选中 Session 的记忆 (${selected.size})`}
                  </button>
                )}
                {extractResult && (
                  <p className={clsx("mt-1.5 rounded-md px-3 py-1.5 text-xs",
                    extractResult.includes("成功") ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
                    {extractResult}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

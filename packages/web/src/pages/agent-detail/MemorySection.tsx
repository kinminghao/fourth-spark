import { useCallback, useEffect, useMemo, useState } from "react"
import { Brain, Clock, Loader2 } from "lucide-react"
import clsx from "clsx"
import * as api from "../../lib/api-client"
import type { AgentMemory, AgentSession, ConsolidationStats } from "../../lib/api-client"
import { GUIDE_AGENT_PREFIX, MOCK_MEMORIES } from "../../components/guide-mock-data"
import { getCategoryStyle, formatRelativeTime } from "./agent-utils"
import { MemoryItem } from "./MemoryItem"
import { ConsolidationStatsBar } from "./ConsolidationStatsBar"

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

import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Brain, Check, Clipboard, Clock, Download, Edit3, Loader2, Trash2, X, Zap } from "lucide-react"
import clsx from "clsx"
import * as api from "../lib/api-client"
import type { AgentMemory, AgentSession, CustomAgent, ModelInfo, PromptFragment } from "../lib/api-client"
import { useCustomAgentStore } from "../stores/custom-agent-store"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"

const BASE_AGENTS = ["Sisyphus - ultraworker", "Prometheus - Plan Builder", "Atlas - Plan Executor"]
const PINNED_MODELS_KEY = "pinned_models"
const SP_KEY = "__system_prompt__"

// Deterministic initial-letter avatar. Static class strings so Tailwind can pick them up.
const AGENT_AVATAR_PALETTE = [
  { bg: "bg-blue-500/15", text: "text-blue-500" },
  { bg: "bg-purple-500/15", text: "text-purple-500" },
  { bg: "bg-emerald-500/15", text: "text-emerald-500" },
  { bg: "bg-amber-500/15", text: "text-amber-500" },
  { bg: "bg-rose-500/15", text: "text-rose-500" },
  { bg: "bg-cyan-500/15", text: "text-cyan-500" },
  { bg: "bg-indigo-500/15", text: "text-indigo-500" },
  { bg: "bg-orange-500/15", text: "text-orange-500" },
] as const

function agentAvatar(name: string): { bg: string; text: string; initial: string } {
  const trimmed = name.trim()
  const code = trimmed.charCodeAt(0) || 0
  const palette = AGENT_AVATAR_PALETTE[code % AGENT_AVATAR_PALETTE.length]
  return { ...palette, initial: (trimmed.charAt(0) || "?").toUpperCase() }
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  decision: { bg: "bg-blue-500/10", text: "text-blue-400" },
  lesson: { bg: "bg-amber-500/10", text: "text-amber-400" },
  preference: { bg: "bg-green-500/10", text: "text-green-400" },
  pattern: { bg: "bg-purple-500/10", text: "text-purple-400" },
  general: { bg: "bg-elevated", text: "text-fg-4" },
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "刚刚"
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
}

// ---------------------------------------------------------------------------
// MemoryItem
// ---------------------------------------------------------------------------

function MemoryItem({ memory, onUpdate, onDelete }: {
  memory: AgentMemory
  onUpdate: (memId: string, data: { content?: string; category?: string; importance?: number }) => Promise<void>
  onDelete: (memId: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(memory.content)
  const [category, setCategory] = useState(memory.category)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const style = CATEGORY_STYLES[memory.category] ?? CATEGORY_STYLES.general

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
            <option value="decision">decision</option>
            <option value="lesson">lesson</option>
            <option value="preference">preference</option>
            <option value="pattern">pattern</option>
            <option value="general">general</option>
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
          <Zap className="h-3 w-3" /> {memory.importance.toFixed(2)}
        </span>
        <span>·</span>
        <span>{formatRelativeTime(memory.updatedAt)}</span>
        {memory.supersededBy && (
          <>
            <span>·</span>
            <span className="text-amber-400">{memory.supersededBy === "user-deleted" ? "已删除" : "已合并"}</span>
          </>
        )}
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
    </div>
  )
}

// ---------------------------------------------------------------------------
// MemorySection
// ---------------------------------------------------------------------------

function MemorySection({ agentId }: { agentId: string }) {
  const [memories, setMemories] = useState<AgentMemory[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string | null>(null)
  const [showSuperseded, setShowSuperseded] = useState(false)
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [showSessions, setShowSessions] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [extracting, setExtracting] = useState(false)
  const [extractResult, setExtractResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listAgentMemories(agentId, {
        category: filter ?? undefined,
        includeSuperseded: showSuperseded,
      })
      setMemories(data)
    } catch {
      setMemories([])
    }
    setLoading(false)
  }, [agentId, filter, showSuperseded])

  useEffect(() => { void load() }, [load])

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

  const active = memories.filter(m => !m.supersededBy)
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

  const categories = ["decision", "lesson", "preference", "pattern"] as const

  return (
    <section className="rounded-xl border border-line bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-400" />
          <h2 className="text-sm font-semibold text-fg">记忆</h2>
          {!loading && <span className="rounded-full bg-elevated px-1.5 py-0.5 text-[10px] tabular-nums text-fg-4">{active.length}</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setFilter(null)}
          className={clsx("rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
            filter === null ? "bg-fg/10 text-fg" : "text-fg-4 hover:text-fg-3")}>
          全部
        </button>
        {categories.map(cat => {
          const s = CATEGORY_STYLES[cat]
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
            <MemoryItem key={m.id} memory={m} onUpdate={handleUpdate} onDelete={handleDelete} />
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
                    <MemoryItem key={m.id} memory={m} onUpdate={handleUpdate} onDelete={handleDelete} />
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

// ---------------------------------------------------------------------------
// SessionList
// ---------------------------------------------------------------------------

function SessionList({ agentId }: { agentId: string }) {
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    api.listAgentSessions(agentId)
      .then(data => { if (!cancelled) setSessions(data) })
      .catch(() => { if (!cancelled) setSessions([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [agentId])

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-fg-4" />
        <h2 className="text-sm font-semibold text-fg">Session 历史</h2>
        {!loading && <span className="rounded-full bg-elevated px-1.5 py-0.5 text-[10px] tabular-nums text-fg-4">{sessions.length}</span>}
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 fs-spin text-fg-5" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="py-8 text-center text-xs text-fg-5">暂无 Session 记录。</p>
        ) : (
          <div className="space-y-1">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border border-line bg-base px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-fg">{s.title || s.id.slice(-8)}</span>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-5">
                    <span>{formatRelativeTime(s.timeCreated)}</span>
                    {s.cost > 0 && (
                      <>
                        <span>·</span>
                        <span>${s.cost.toFixed(4)}</span>
                      </>
                    )}
                    {(s.tokensInput > 0 || s.tokensOutput > 0) && (
                      <>
                        <span>·</span>
                        <span>{Math.round((s.tokensInput + s.tokensOutput) / 1000)}K tokens</span>
                      </>
                    )}
                  </div>
                </div>
                {s.completedAt ? (
                  <span className="shrink-0 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">完成</span>
                ) : (
                  <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[10px] font-medium text-fg-5">进行中</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// ConfigSection — edit agent configuration
// ---------------------------------------------------------------------------

function ConfigSection({ agent, fragments, onSave }: {
  agent: CustomAgent
  fragments: PromptFragment[]
  onSave: (data: { name: string; description?: string; baseAgent: string; model?: string; systemPrompt?: string; systemPromptPosition?: number; fragmentIds?: string[] }) => Promise<void>
}) {
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description ?? "")
  const [baseAgent, setBaseAgent] = useState(agent.baseAgent)
  const [model, setModel] = useState(agent.model ?? "")
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt)
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pinnedModels, setPinnedModels] = useState<ModelInfo[]>([])

  useEffect(() => {
    if (!activeRepoId) { setPinnedModels([]); return }
    let cancelled = false
    void (async () => {
      try {
        const [settings, models] = await Promise.all([api.getSettings(), api.listModels(activeRepoId)])
        if (cancelled) return
        const raw = settings[PINNED_MODELS_KEY]
        const pinnedIds: string[] = raw ? JSON.parse(raw) : []
        setPinnedModels(pinnedIds.length > 0 ? models.filter((m) => pinnedIds.includes(m.id)) : [])
      } catch {
        if (!cancelled) setPinnedModels([])
      }
    })()
    return () => { cancelled = true }
  }, [activeRepoId])

  const [orderedItems, setOrderedItems] = useState<string[]>(() => {
    const fragIds = agent.fragments.map((f) => f.id)
    const pos = agent.systemPromptPosition ?? -1
    const insertAt = pos >= 0 && pos <= fragIds.length ? pos : fragIds.length
    const items = [...fragIds]
    items.splice(insertAt, 0, SP_KEY)
    return items
  })

  const toggleFragment = (id: string) => {
    setOrderedItems((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      const spIdx = prev.indexOf(SP_KEY)
      const items = [...prev]
      items.splice(spIdx >= 0 ? spIdx : items.length, 0, id)
      return items
    })
  }

  const moveItem = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= orderedItems.length) return
    setOrderedItems((prev) => {
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  const selectedIds = orderedItems.filter((id) => id !== SP_KEY)
  const spPosition = (() => {
    const spIdx = orderedItems.indexOf(SP_KEY)
    if (spIdx < 0) return -1
    return orderedItems.slice(0, spIdx).filter((id) => id !== SP_KEY).length
  })()

  const preview = orderedItems
    .map((id) => id === SP_KEY ? systemPrompt : fragments.find((f) => f.id === id)?.content)
    .filter(Boolean)
    .join("\n\n---\n\n")

  const submit = async () => {
    if (!name.trim() || !baseAgent) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), description: description.trim() || undefined, baseAgent, model: model.trim() || undefined, systemPrompt, systemPromptPosition: spPosition, fragmentIds: selectedIds })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const isSystem = agent.isSystem >= 1

  if (!editing) {
    return (
      <section className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">配置</h2>
          {!isSystem && (
            <button type="button" onClick={() => setEditing(true)}
              className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs text-fg-4 transition-colors hover:bg-elevated hover:text-fg-3">
              <Edit3 className="h-3 w-3" /> 编辑
            </button>
          )}
        </div>
        <div className="mt-3 space-y-2.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-fg-5">Base Agent</span>
            <span className="font-mono text-fg">{agent.baseAgent}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-fg-5">模型</span>
            <span className="font-mono text-fg">{agent.model || "默认"}</span>
          </div>
          {agent.fragments.length > 0 && (
            <div className="flex items-start gap-2 text-xs">
              <span className="w-20 shrink-0 pt-0.5 text-fg-5">片段</span>
              <div className="flex flex-wrap gap-1">
                {agent.fragments.map(f => (
                  <span key={f.id} className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">{f.name}</span>
                ))}
              </div>
            </div>
          )}
          {agent.systemPrompt && (
            <div className="flex items-start gap-2 text-xs">
              <span className="w-20 shrink-0 pt-0.5 text-fg-5">补充指令</span>
              <p className="min-w-0 truncate font-mono text-fg-4">{agent.systemPrompt}</p>
            </div>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-blue-500/30 bg-surface p-5 space-y-3">
      <h2 className="text-sm font-semibold text-fg">编辑配置</h2>
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs font-medium text-fg-3">名称</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-base px-3 py-1.5 text-sm text-fg focus:border-blue-500 focus:outline-none" />
        </label>
        <label className="w-36">
          <span className="text-xs font-medium text-fg-3">Base Agent</span>
          <select value={baseAgent} onChange={(e) => setBaseAgent(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-base px-3 py-1.5 text-sm text-fg focus:border-blue-500 focus:outline-none">
            {BASE_AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-fg-3">描述（可选）</span>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话描述这个 Agent 的用途"
          className="mt-1 w-full rounded-md border border-line bg-base px-3 py-1.5 text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none" />
      </label>
      <div>
        <span className="text-xs font-medium text-fg-3">模型（可选）</span>
        <select value={model} onChange={(e) => setModel(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-base px-3 py-1.5 font-mono text-sm text-fg focus:border-blue-500 focus:outline-none">
          <option value="">默认模型</option>
          {pinnedModels.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
        </select>
      </div>

      <div>
        <span className="text-xs font-medium text-fg-3">提示词组合</span>
        <div className="mt-1.5 space-y-1">
          {orderedItems.map((id, idx) => {
            if (id === SP_KEY) {
              return (
                <div key={id} className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1">
                  <div className="flex flex-col">
                    <button type="button" onClick={() => moveItem(idx, -1)} disabled={idx === 0} className="text-[10px] leading-none text-fg-5 hover:text-fg-2 disabled:opacity-30">▲</button>
                    <button type="button" onClick={() => moveItem(idx, 1)} disabled={idx === orderedItems.length - 1} className="text-[10px] leading-none text-fg-5 hover:text-fg-2 disabled:opacity-30">▼</button>
                  </div>
                  <span className="flex-1 truncate text-xs font-medium text-amber-400">✎ 补充指令</span>
                </div>
              )
            }
            const frag = fragments.find((f) => f.id === id)
            if (!frag) return null
            return (
              <div key={id} className="flex items-center gap-2 rounded border border-blue-500/30 bg-blue-500/5 px-2 py-1">
                <div className="flex flex-col">
                  <button type="button" onClick={() => moveItem(idx, -1)} disabled={idx === 0} className="text-[10px] leading-none text-fg-5 hover:text-fg-2 disabled:opacity-30">▲</button>
                  <button type="button" onClick={() => moveItem(idx, 1)} disabled={idx === orderedItems.length - 1} className="text-[10px] leading-none text-fg-5 hover:text-fg-2 disabled:opacity-30">▼</button>
                </div>
                <span className="flex-1 truncate text-xs text-fg">{frag.name}</span>
                <button type="button" onClick={() => toggleFragment(id)} className="text-fg-5 hover:text-red-400"><X className="h-3 w-3" /></button>
              </div>
            )
          })}
          {fragments.filter((f) => !selectedIds.includes(f.id)).length > 0 && (
            <select value="" onChange={(e) => { if (e.target.value) toggleFragment(e.target.value) }}
              className="w-full rounded border border-dashed border-line bg-base px-2 py-1 text-xs text-fg-4 focus:border-blue-500 focus:outline-none">
              <option value="">+ 添加片段…</option>
              {fragments.filter((f) => !selectedIds.includes(f.id)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-fg-3">补充指令内容</span>
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={4}
          className="mt-1 w-full resize-y rounded-md border border-line bg-base px-3 py-2 font-mono text-sm leading-relaxed text-fg focus:border-blue-500 focus:outline-none" />
      </label>

      {(selectedIds.length > 0 || systemPrompt) && (
        <div>
          <button type="button" onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-1 text-xs font-medium text-fg-4 hover:text-fg-3">
            <span>{showPreview ? "▾" : "▸"}</span> 预览最终提示词
          </button>
          {showPreview && (
            <pre className="mt-1 max-h-48 overflow-auto rounded border border-line bg-elevated px-3 py-2 font-mono text-xs leading-relaxed text-fg-4">
              {preview || "(空)"}
            </pre>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={() => setEditing(false)} className="rounded-md px-3 py-1.5 text-xs text-fg-4 hover:bg-elevated">取消</button>
        <button type="button" onClick={() => void submit()} disabled={saving || !name.trim()}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40">
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// AgentDetailPage
// ---------------------------------------------------------------------------

export function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const repoName = useRepoStore(selectActiveRepoName)
  const agents = useCustomAgentStore((s) => s.agents)
  const agent = agents.find(a => a.id === agentId)
  const [fragments, setFragments] = useState<PromptFragment[]>([])
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    api.listGlobalFragments()
      .then(setFragments)
      .catch(() => setFragments([]))
  }, [])

  useEffect(() => {
    if (agents.length > 0 && !agent) {
      navigate(repoName ? `/${encodeURIComponent(repoName)}/agents` : "/repos", { replace: true })
    }
  }, [agents, agent, navigate, repoName])

  const handleSave = async (data: { name: string; baseAgent: string; model?: string; systemPrompt?: string; systemPromptPosition?: number; fragmentIds?: string[] }) => {
    if (!agentId) return
    await api.updateCustomAgent(agentId, data)
    void useCustomAgentStore.getState().loadAgents()
  }

  const handleDelete = async () => {
    if (!agentId) return
    await api.deleteCustomAgent(agentId)
    void useCustomAgentStore.getState().loadAgents()
    navigate(repoName ? `/${encodeURIComponent(repoName)}/agents` : "/repos", { replace: true })
  }

  const handleExportDownload = async () => {
    if (!agentId || !agent) return
    const data = await api.exportCustomAgent(agentId)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${agent.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_")}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportCopy = async () => {
    if (!agentId) return
    const data = await api.exportCustomAgent(agentId)
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!agent || !agentId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 fs-spin text-fg-5" />
      </div>
    )
  }

  const isSystem = agent.isSystem >= 1
  const avatar = agentAvatar(agent.name)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate(repoName ? `/${encodeURIComponent(repoName)}/agents` : "/repos")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-fg-4 transition-colors hover:bg-elevated hover:text-fg-3"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className={clsx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold",
            avatar.bg,
            avatar.text,
          )}>
            {avatar.initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-bold text-fg">{agent.name}</h1>
              {isSystem && (
                <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">系统</span>
              )}
              {agent.repoId && (
                <span className="shrink-0 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">repo</span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-fg-4">
              <span className="font-mono">{agent.baseAgent}</span>
              {agent.model && <span className="ml-1.5 text-fg-5">· {agent.model}</span>}
            </p>
            {agent.description && (
              <p className="mt-1 text-xs text-fg-4">{agent.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => void handleExportDownload()} title="导出 JSON"
              className="rounded-md border border-line p-1.5 text-fg-4 transition-colors hover:bg-elevated hover:text-fg-3">
              <Download className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => void handleExportCopy()} title="复制 JSON"
              className="rounded-md border border-line p-1.5 text-fg-4 transition-colors hover:bg-elevated hover:text-fg-3">
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Clipboard className="h-4 w-4" />}
            </button>
            {!isSystem && (
              deleting ? (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => void handleDelete()} className="rounded-md border border-red-500/30 p-1.5 text-red-400 hover:bg-red-500/10">
                    <Check className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setDeleting(false)} className="rounded-md border border-line p-1.5 text-fg-4 hover:bg-elevated">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setDeleting(true)} title="删除"
                  className="rounded-md border border-line p-1.5 text-fg-4 transition-colors hover:border-red-500/30 hover:text-red-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              )
            )}
          </div>
        </div>

        {/* Config */}
        <ConfigSection agent={agent} fragments={fragments} onSave={handleSave} />

        {/* Memory */}
        <MemorySection agentId={agentId} />

        {/* Sessions */}
        <SessionList agentId={agentId} />
      </div>
    </div>
  )
}

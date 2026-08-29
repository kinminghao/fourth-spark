import React, { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangle, Brain, Check, Clock, ChevronDown, Edit3, Loader2, Plus, Upload, Trash2, X } from "lucide-react"
import clsx from "clsx"
import * as api from "../lib/api-client"
import type { CustomAgent, CustomAgentExport, ModelInfo, PromptFragment } from "../lib/api-client"
import { useCustomAgentStore } from "../stores/custom-agent-store"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// AgentCard — card grid item
// ---------------------------------------------------------------------------

function AgentCard({ agent, memoryCount, sessionCount, onClick, onDelete }: {
  agent: CustomAgent
  memoryCount: number
  sessionCount: number
  onClick: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const isSystem = agent.isSystem === 1
  const avatar = agentAvatar(agent.name)

  return (
    <div
      className="flex cursor-pointer flex-col rounded-xl border border-line bg-surface transition-colors hover:border-fg-6/60"
      onClick={onClick}
    >
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className={clsx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold",
          avatar.bg,
          avatar.text,
        )}>
          {avatar.initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-fg">{agent.name}</span>
            {isSystem && (
              <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">系统</span>
            )}
            {agent.repoId && (
              <span className="shrink-0 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">repo</span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-fg-4">
            <span className="font-mono">{agent.baseAgent}</span>
            {agent.model && <span className="ml-1.5 text-fg-5">· {agent.model}</span>}
          </p>
          {agent.description && (
            <p className="mt-1 text-xs text-fg-5 line-clamp-2">{agent.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 border-t border-line/60 px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-[11px] text-fg-5">
          <Brain className="h-3 w-3" />
          <span>记忆 {memoryCount}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-fg-5">
          <Clock className="h-3 w-3" />
          <span>会话 {sessionCount}</span>
        </span>
        <div className="flex-1" />
        {!isSystem && !confirming && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirming(true) }} title="删除"
            className="rounded p-1 text-fg-5 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 [.group:hover_&]:opacity-100">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        {confirming && (
          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={onDelete} className="rounded p-1 text-red-400 hover:bg-red-500/10">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded p-1 text-fg-4 hover:bg-elevated">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CustomAgentForm
// ---------------------------------------------------------------------------

function CustomAgentForm({ initial, availableFragments, onSave, onCancel }: {
  initial?: CustomAgent
  availableFragments: PromptFragment[]
  onSave: (data: { name: string; description?: string; baseAgent: string; model?: string; variant?: string; systemPrompt?: string; systemPromptPosition?: number; fragmentIds?: string[] }) => Promise<void>
  onCancel: () => void
}) {
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [baseAgent, setBaseAgent] = useState(initial?.baseAgent ?? "Sisyphus - ultraworker")
  const [model, setModel] = useState(initial?.model ?? "")
  const [variant, setVariant] = useState(initial?.variant ?? "")
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "")
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pinnedModels, setPinnedModels] = useState<ModelInfo[]>([])

  useEffect(() => {
    if (!activeRepoId) { setPinnedModels([]); return }
    let cancelled = false
    void (async () => {
      try {
        const [settings, models] = await Promise.all([
          api.getSettings(),
          api.listModels(activeRepoId),
        ])
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
    const fragIds = initial?.fragments.map((f) => f.id) ?? []
    const pos = initial?.systemPromptPosition ?? -1
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
    .map((id) => id === SP_KEY ? systemPrompt : availableFragments.find((f) => f.id === id)?.content)
    .filter(Boolean)
    .join("\n\n---\n\n")

  const submit = async () => {
    if (!name.trim() || !baseAgent) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), description: description.trim() || undefined, baseAgent, model: model.trim() || undefined, variant: variant.trim() || undefined, systemPrompt, systemPromptPosition: spPosition, fragmentIds: selectedIds })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-5">
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs font-medium text-fg-3">名称</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="代码审查员"
            className="mt-1 w-full rounded-md border border-line bg-base px-3 py-1.5 text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none" />
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
      <div className="flex gap-3">
        <div className="flex-1">
          <span className="text-xs font-medium text-fg-3">模型（可选）</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-base px-3 py-1.5 font-mono text-sm text-fg focus:border-blue-500 focus:outline-none"
          >
            <option value="">默认模型</option>
            {pinnedModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name || m.id}</option>
            ))}
          </select>
          {pinnedModels.length === 0 && (
            <p className="mt-1 text-[11px] text-fg-5">在设置的「模型」中勾选常用模型后可选择。</p>
          )}
        </div>
        <div className="w-28">
          <span className="text-xs font-medium text-fg-3">Variant</span>
          <select
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-base px-3 py-1.5 font-mono text-sm text-fg focus:border-blue-500 focus:outline-none"
          >
            <option value="">默认</option>
            <option value="max">max</option>
            <option value="high">high</option>
          </select>
        </div>
      </div>

      <div>
        <span className="text-xs font-medium text-fg-3">提示词组合</span>
        <p className="mt-0.5 text-[11px] text-fg-5">排序片段与补充指令的拼接顺序。</p>
        <div className="mt-1.5 space-y-1">
          {orderedItems.map((id, idx) => {
            if (id === SP_KEY) {
              return (
                <div key={id} className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1">
                  <div className="flex flex-col">
                    <button type="button" onClick={() => moveItem(idx, -1)} disabled={idx === 0}
                      className="text-[10px] leading-none text-fg-5 hover:text-fg-2 disabled:opacity-30">▲</button>
                    <button type="button" onClick={() => moveItem(idx, 1)} disabled={idx === orderedItems.length - 1}
                      className="text-[10px] leading-none text-fg-5 hover:text-fg-2 disabled:opacity-30">▼</button>
                  </div>
                  <span className="flex-1 truncate text-xs font-medium text-amber-400">✎ 补充指令</span>
                </div>
              )
            }
            const frag = availableFragments.find((f) => f.id === id)
            if (!frag) return null
            return (
              <div key={id} className="flex items-center gap-2 rounded border border-blue-500/30 bg-blue-500/5 px-2 py-1">
                <div className="flex flex-col">
                  <button type="button" onClick={() => moveItem(idx, -1)} disabled={idx === 0}
                    className="text-[10px] leading-none text-fg-5 hover:text-fg-2 disabled:opacity-30">▲</button>
                  <button type="button" onClick={() => moveItem(idx, 1)} disabled={idx === orderedItems.length - 1}
                    className="text-[10px] leading-none text-fg-5 hover:text-fg-2 disabled:opacity-30">▼</button>
                </div>
                <span className="flex-1 truncate text-xs text-fg">{frag.name}</span>
                <button type="button" onClick={() => toggleFragment(id)} className="text-fg-5 hover:text-red-400">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
          {availableFragments.filter((f) => !selectedIds.includes(f.id)).length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) toggleFragment(e.target.value) }}
              className="w-full rounded border border-dashed border-line bg-base px-2 py-1 text-xs text-fg-4 focus:border-blue-500 focus:outline-none"
            >
              <option value="">+ 添加片段…</option>
              {availableFragments.filter((f) => !selectedIds.includes(f.id)).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-fg-3">补充指令内容</span>
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3}
          placeholder="agent 级别的补充指令…"
          className="mt-1 w-full resize-y rounded-md border border-line bg-base px-3 py-2 font-mono text-sm leading-relaxed text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none" />
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
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs text-fg-4 hover:bg-elevated">取消</button>
        <button type="button" onClick={() => void submit()} disabled={saving || !name.trim()}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40">
          {saving ? "保存中…" : initial ? "更新" : "创建"}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FragmentRow / FragmentForm
// ---------------------------------------------------------------------------

function FragmentRow({ fragment, onEdit, onDelete }: { fragment: PromptFragment; onEdit: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-line bg-base px-3 py-2">
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-fg">{fragment.name}</span>
        {fragment.content && <p className="mt-0.5 truncate font-mono text-[11px] text-fg-5">{fragment.content}</p>}
      </div>
      <div className="flex items-center gap-1">
        {confirming ? (
          <>
            <button type="button" onClick={onDelete} className="rounded p-1 text-red-400 hover:bg-red-500/10"><Check className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded p-1 text-fg-4 hover:bg-elevated"><X className="h-3.5 w-3.5" /></button>
          </>
        ) : (
          <>
            <button type="button" onClick={onEdit} className="rounded p-1 text-fg-5 opacity-0 transition-opacity hover:text-fg-3 group-hover:opacity-100"><Edit3 className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => setConfirming(true)} className="rounded p-1 text-fg-5 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
          </>
        )}
      </div>
    </div>
  )
}

function FragmentForm({ initial, onSave, onCancel }: {
  initial?: PromptFragment
  onSave: (data: { name: string; content: string }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [content, setContent] = useState(initial?.content ?? "")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setSaving(true)
    try { await onSave({ name: name.trim(), content }) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-base p-3">
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="片段名称"
        className="w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none" />
      <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="提示词内容…"
        className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm leading-relaxed text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none" />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1 text-xs text-fg-4 hover:bg-elevated">取消</button>
        <button type="button" onClick={() => void submit()} disabled={saving || !name.trim()}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40">
          {saving ? "保存中…" : initial ? "更新" : "创建"}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ImportAgentForm
// ---------------------------------------------------------------------------

function ImportAgentForm({ onImported, onCancel }: { onImported: () => void; onCancel: () => void }) {
  const [jsonText, setJsonText] = useState("")
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const doImport = async (text: string) => {
    setError(null)
    let parsed: CustomAgentExport
    try {
      parsed = JSON.parse(text) as CustomAgentExport
    } catch {
      setError("JSON 格式无效")
      return
    }
    if (parsed.type !== "fourth-spark-custom-agent" || !parsed.agent) {
      setError("不是有效的 Custom Agent 导出文件")
      return
    }
    setImporting(true)
    try {
      await api.importCustomAgent(parsed)
      onImported()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      setJsonText(text)
      void doImport(text)
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg-3">导入 Custom Agent</span>
        <button type="button" onClick={onCancel} className="rounded p-1 text-fg-5 hover:text-fg-3">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <input ref={fileRef} type="file" accept=".json" onChange={handleFile} className="hidden" />
      <button type="button" onClick={() => fileRef.current?.click()}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line py-2.5 text-xs text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-3">
        <Upload className="h-3.5 w-3.5" /> 上传 JSON 文件
      </button>

      <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={4}
        placeholder="或粘贴 JSON 内容…"
        className="w-full resize-y rounded-md border border-line bg-base px-3 py-2 font-mono text-xs leading-relaxed text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none" />

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs text-fg-4 hover:bg-elevated">取消</button>
        <button type="button" onClick={() => void doImport(jsonText)} disabled={importing || !jsonText.trim()}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40">
          {importing ? "导入中…" : "导入"}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AgentsPage (main)
// ---------------------------------------------------------------------------

export function AgentsPage() {
  const navigate = useNavigate()
  const repoName = useRepoStore(selectActiveRepoName)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const [agents, setAgents] = useState<CustomAgent[]>([])
  const [fragments, setFragments] = useState<PromptFragment[]>([])
  const [loading, setLoading] = useState(true)
  const [showAgentForm, setShowAgentForm] = useState(false)
  const [showFragForm, setShowFragForm] = useState(false)
  const [editingFrag, setEditingFrag] = useState<PromptFragment | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [fragsOpen, setFragsOpen] = useState(false)

  // Stats caches
  const [memoryCounts, setMemoryCounts] = useState<Record<string, number>>({})
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({})

  const load = useCallback(() => {
    const agentsP = activeRepoId
      ? api.listRepoCustomAgents(activeRepoId)
      : api.listGlobalCustomAgents()
    Promise.all([agentsP, api.listGlobalFragments()])
      .then(([a, f]) => { setAgents(a); setFragments(f); setLoading(false) })
      .catch(() => setLoading(false))
  }, [activeRepoId])

  useEffect(() => { setLoading(true); load() }, [load])

  // Load stats for each agent
  useEffect(() => {
    if (agents.length === 0) return
    const visible = agents.filter(a => {
      return a.isSystem < 2
    })
    for (const a of visible) {
      api.listAgentMemories(a.id).then(mems => {
        setMemoryCounts(prev => ({ ...prev, [a.id]: mems.filter(m => !m.supersededBy).length }))
      }).catch(() => {})
      api.listAgentSessions(a.id).then(sess => {
        setSessionCounts(prev => ({ ...prev, [a.id]: sess.length }))
      }).catch(() => {})
    }
  }, [agents])

  const visibleAgents = agents.filter(a => {
    return a.isSystem < 2
  })

  const handleCreateAgent = async (data: { name: string; baseAgent: string; model?: string; variant?: string; systemPrompt?: string; systemPromptPosition?: number; fragmentIds?: string[] }) => {
    if (activeRepoId) {
      await api.createRepoCustomAgent(activeRepoId, data)
    } else {
      await api.createGlobalCustomAgent(data)
    }
    setShowAgentForm(false)
    load()
    void useCustomAgentStore.getState().loadAgents()
  }

  const handleDeleteAgent = async (id: string) => {
    await api.deleteCustomAgent(id)
    setAgents(prev => prev.filter(a => a.id !== id))
    void useCustomAgentStore.getState().loadAgents()
  }

  const handleCreateFrag = async (data: { name: string; content: string }) => {
    await api.createGlobalFragment(data)
    setShowFragForm(false)
    load()
  }

  const handleUpdateFrag = async (data: { name: string; content: string }) => {
    if (!editingFrag) return
    await api.updateFragment(editingFrag.id, data)
    setEditingFrag(null)
    load()
  }

  const handleDeleteFrag = async (id: string) => {
    await api.deleteFragment(id)
    setFragments(prev => prev.filter(f => f.id !== id))
  }

  if (!activeRepoId) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-fg-4">请先在顶部选择一个仓库。</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-fg">Agents</h1>
            <p className="mt-0.5 text-xs text-fg-4">组合 base agent + 模型 + 提示词片段，创建 Session 时选择。</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { setShowImport(true); setShowAgentForm(false) }}
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-fg-3 transition-colors hover:bg-elevated">
              <Upload className="h-3.5 w-3.5" /> 导入
            </button>
            <button type="button" onClick={() => { setShowAgentForm(true); setShowImport(false) }}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500">
              <Plus className="h-3.5 w-3.5" /> 创建
            </button>
          </div>
        </div>

        {/* Create / Import forms */}
        {showAgentForm && (
          <CustomAgentForm availableFragments={fragments} onSave={handleCreateAgent} onCancel={() => setShowAgentForm(false)} />
        )}
        {showImport && (
          <ImportAgentForm onImported={() => { setShowImport(false); load(); void useCustomAgentStore.getState().loadAgents() }} onCancel={() => setShowImport(false)} />
        )}

        {/* Agent cards grid */}
        {loading ? (
          <div className="flex flex-col items-center gap-2.5 py-16 text-fg-5">
            <Loader2 className="h-5 w-5 fs-spin" />
            <p className="text-xs">加载中…</p>
          </div>
        ) : visibleAgents.length === 0 && !showAgentForm ? (
          <div className="flex flex-col items-center gap-3 py-16 text-fg-5">
            <Brain className="h-8 w-8 text-fg-6" />
            <p className="text-sm">还没有 Agent</p>
            <p className="text-xs text-fg-5">点击上方「创建」开始。</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleAgents.map(a => (
              <div key={a.id} className="group">
                <AgentCard
                  agent={a}
                  memoryCount={memoryCounts[a.id] ?? 0}
                  sessionCount={sessionCounts[a.id] ?? 0}
                  onClick={() => navigate(`/${encodeURIComponent(repoName ?? "")}/agents/${a.id}`)}
                  onDelete={() => void handleDeleteAgent(a.id)}
                />
              </div>
            ))}
          </div>
        )}

        {/* Prompt Fragments (collapsible) */}
        <section className="rounded-xl border border-line bg-surface">
          <button
            type="button"
            onClick={() => setFragsOpen(!fragsOpen)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div>
              <h2 className="text-sm font-semibold text-fg">提示词片段</h2>
              <p className="mt-0.5 text-xs text-fg-4">可复用的提示词模块，可在多个 Agent 间共享。</p>
            </div>
            <ChevronDown className={clsx("h-4 w-4 shrink-0 text-fg-4 transition-transform", fragsOpen && "rotate-180")} />
          </button>

          {fragsOpen && (
            <div className="border-t border-line px-5 pb-5 pt-3">
              <div className="space-y-1.5">
                {fragments.map(f =>
                  editingFrag?.id === f.id ? (
                    <FragmentForm key={f.id} initial={f} onSave={handleUpdateFrag} onCancel={() => setEditingFrag(null)} />
                  ) : (
                    <FragmentRow key={f.id} fragment={f} onEdit={() => setEditingFrag(f)} onDelete={() => void handleDeleteFrag(f.id)} />
                  ),
                )}
                {showFragForm ? (
                  <FragmentForm onSave={handleCreateFrag} onCancel={() => setShowFragForm(false)} />
                ) : (
                  <button type="button" onClick={() => setShowFragForm(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-xs text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-3">
                    <Plus className="h-3.5 w-3.5" /> 添加片段
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

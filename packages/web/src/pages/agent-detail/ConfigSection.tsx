import { useEffect, useState } from "react"
import { Edit3, X } from "lucide-react"
import clsx from "clsx"
import * as api from "../../lib/api-client"
import type { CustomAgent, ModelInfo, PromptFragment } from "../../lib/api-client"
import { useRepoStore } from "../../stores/repo-store"
import { BASE_AGENTS, PINNED_MODELS_KEY, SP_KEY } from "./agent-utils"

export function ConfigSection({ agent, fragments, onSave }: {
  agent: CustomAgent
  fragments: PromptFragment[]
  onSave: (data: { name: string; description?: string; baseAgent: string; model?: string; variant?: string; memoryModel?: string | null; systemPrompt?: string; systemPromptPosition?: number; fragmentIds?: string[] }) => Promise<void>
}) {
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description ?? "")
  const [baseAgent, setBaseAgent] = useState(agent.baseAgent)
  const [model, setModel] = useState(agent.model ?? "")
  const [variant, setVariant] = useState(agent.variant ?? "")
  const [memoryModel, setMemoryModel] = useState(agent.memoryModel ?? "")
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
        const filtered = pinnedIds.length > 0 ? models.filter((m) => pinnedIds.includes(m.id)) : models
        setPinnedModels(filtered.length > 0 ? filtered : models)
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
      await onSave({ name: name.trim(), description: description.trim() || undefined, baseAgent, model: model.trim() || undefined, variant: variant.trim() || undefined, memoryModel: memoryModel.trim() || null, systemPrompt, systemPromptPosition: spPosition, fragmentIds: selectedIds })
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
          <button type="button" onClick={() => setEditing(true)}
            className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs text-fg-4 transition-colors hover:bg-elevated hover:text-fg-3">
            <Edit3 className="h-3 w-3" /> 编辑
          </button>
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
          <div className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-fg-5">Variant</span>
            <span className="font-mono text-fg">{agent.variant || "默认"}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-fg-5">记忆模型</span>
            <span className="font-mono text-fg">{agent.memoryModel || "跟随主模型"}</span>
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
      {!isSystem && (
        <>
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
        </>
      )}
      <div className="flex gap-3">
        <div className="flex-1">
          <span className="text-xs font-medium text-fg-3">模型（可选）</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-base px-3 py-1.5 font-mono text-sm text-fg focus:border-blue-500 focus:outline-none">
            <option value="">默认模型</option>
            {pinnedModels.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
          </select>
        </div>
        <div className="w-28">
          <span className="text-xs font-medium text-fg-3">Variant</span>
          <select value={variant} onChange={(e) => setVariant(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-base px-3 py-1.5 font-mono text-sm text-fg focus:border-blue-500 focus:outline-none">
            <option value="">默认</option>
            <option value="max">max</option>
            <option value="high">high</option>
          </select>
        </div>
      </div>
      <div>
        <span className="text-xs font-medium text-fg-3">记忆提取/整理模型</span>
        <select value={memoryModel} onChange={(e) => setMemoryModel(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-base px-3 py-1.5 font-mono text-sm text-fg focus:border-blue-500 focus:outline-none">
          <option value="">跟随主模型</option>
          {pinnedModels.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
        </select>
      </div>

      {!isSystem && (
        <>
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
        </>
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

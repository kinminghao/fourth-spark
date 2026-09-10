import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Cpu, Loader2, Search, X } from "lucide-react"
import clsx from "clsx"
import * as api from "../../lib/api-client"
import type { ModelInfo } from "../../lib/api-client"
import { useRepoStore } from "../../stores/repo-store"

const PINNED_MODELS_KEY = "pinned_models"

type GroupedModels = { provider: string; models: ModelInfo[] }[]

function groupModelsByProvider(models: ModelInfo[]): GroupedModels {
  const map = new Map<string, ModelInfo[]>()
  for (const m of models) {
    const key = m.providerName || m.providerID
    const list = map.get(key)
    if (list) list.push(m)
    else map.set(key, [m])
  }
  return Array.from(map, ([provider, models]) => ({ provider, models })).sort((a, b) => {
    const aCfg = a.models.some((m) => m.configured)
    const bCfg = b.models.some((m) => m.configured)
    if (aCfg !== bCfg) return aCfg ? -1 : 1
    return a.provider.localeCompare(b.provider)
  })
}

function fmtCtx(limit: number | undefined): string {
  if (!limit) return ""
  if (limit >= 1_000_000) return `${(limit / 1_000_000).toFixed(limit % 1_000_000 === 0 ? 0 : 1)}M`
  if (limit >= 1_000) return `${Math.round(limit / 1_000)}K`
  return String(limit)
}

function fmtCost(cost: { input?: number; output?: number } | undefined): string {
  if (!cost) return ""
  const parts: string[] = []
  if (cost.input != null) parts.push(`$${cost.input}/Mi`)
  if (cost.output != null) parts.push(`$${cost.output}/Mo`)
  return parts.join(" ")
}

function ModelManagementSection() {
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeProvider, setActiveProvider] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [settings, modelList] = await Promise.all([
          api.getSettings(),
          activeRepoId ? api.listModels(activeRepoId) : Promise.resolve([]),
        ])
        if (cancelled) return
        const raw = settings[PINNED_MODELS_KEY]
        const pinned: string[] = raw ? JSON.parse(raw) : []
        setPinnedIds(new Set(pinned))
        setModels(modelList)
        setActiveProvider(null)
        setQuery("")
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [activeRepoId])

  const toggleModel = async (modelId: string) => {
    const next = new Set(pinnedIds)
    if (next.has(modelId)) next.delete(modelId)
    else next.add(modelId)
    setPinnedIds(next)
    try {
      await api.updateSetting(PINNED_MODELS_KEY, JSON.stringify([...next]))
    } catch {
      setPinnedIds(pinnedIds)
    }
  }

  const grouped = useMemo(() => groupModelsByProvider(models), [models])
  const pinnedCount = models.filter((m) => pinnedIds.has(m.id)).length

  const selectedGroup = activeProvider
    ? grouped.find((g) => g.provider === activeProvider)
    : grouped[0]

  const q = query.trim().toLowerCase()
  const visibleModels = selectedGroup
    ? (q ? selectedGroup.models.filter((m) => (m.name || m.id).toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : selectedGroup.models)
    : []

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
            <Cpu className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">常用模型</h2>
            <p className="mt-0.5 text-xs text-fg-4">
              勾选常用模型，在新建对话时快速选择。
              {pinnedCount > 0 && <span className="ml-1 text-blue-400">已选 {pinnedCount} 个</span>}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        {!activeRepoId ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-fg-5">
            <Cpu className="h-5 w-5" />
            <p className="text-xs">请先在左侧选择一个仓库以加载可用模型。</p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-fg-5">
            <Loader2 className="h-5 w-5 fs-spin" />
            <p className="text-xs">加载模型列表…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-red-400">
            <AlertTriangle className="h-5 w-5" />
            <p className="max-w-xs text-center text-xs leading-relaxed">{error}</p>
          </div>
        ) : models.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-fg-5">
            <Cpu className="h-5 w-5" />
            <p className="text-xs">当前仓库没有可用模型。</p>
          </div>
        ) : (
          <>
            <div className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-base p-1">
              {grouped.map((g) => {
                const isActive = g.provider === (activeProvider ?? grouped[0]?.provider)
                const count = g.models.filter((m) => pinnedIds.has(m.id)).length
                return (
                  <button
                    key={g.provider}
                    type="button"
                    onClick={() => { setActiveProvider(g.provider); setQuery("") }}
                    className={clsx(
                      "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      isActive ? "bg-surface text-fg shadow-sm" : "text-fg-4 hover:text-fg-3",
                    )}
                  >
                    {g.provider}
                    {count > 0 && (
                      <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-blue-500">
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-base px-3 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-fg-5" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索模型…"
                className="min-w-0 flex-1 bg-transparent text-xs text-fg placeholder:text-fg-6 focus:outline-none"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} className="text-fg-5 hover:text-fg-3">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="mt-3 rounded-lg border border-line bg-base">
              {visibleModels.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-fg-5">无匹配模型</div>
              ) : (
                <div className="divide-y divide-line/40">
                  {visibleModels.map((m) => {
                    const checked = pinnedIds.has(m.id)
                    const ctx = fmtCtx(m.contextLimit)
                    const cost = fmtCost(m.cost)
                    return (
                      <label
                        key={m.id}
                        className={clsx(
                          "flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-elevated/60",
                          checked && "bg-blue-500/5",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => void toggleModel(m.id)}
                          className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-line accent-blue-500"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
                          {m.name || m.id}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {ctx && <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-fg-5">{ctx}</span>}
                          {cost && <span className="text-[10px] text-fg-6">{cost}</span>}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

export { ModelManagementSection }

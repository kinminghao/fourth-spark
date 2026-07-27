import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Loader2, X } from "lucide-react"
import clsx from "clsx"
import type { ModelInfo } from "../lib/api-client"
import { listModels } from "../lib/api-client"

interface ModelComboboxProps {
  value: string
  onChange: (value: string) => void
  repoId: string | null
  placeholder?: string
}

type GroupedModels = { provider: string; models: ModelInfo[] }[]

function groupByProvider(models: ModelInfo[]): GroupedModels {
  const map = new Map<string, ModelInfo[]>()
  for (const m of models) {
    const key = m.providerName || m.providerID
    const list = map.get(key)
    if (list) list.push(m)
    else map.set(key, [m])
  }
  return Array.from(map, ([provider, models]) => ({ provider, models }))
}

function formatContext(limit: number | undefined): string {
  if (!limit) return ""
  if (limit >= 1_000_000) return `${(limit / 1_000_000).toFixed(limit % 1_000_000 === 0 ? 0 : 1)}M`
  if (limit >= 1_000) return `${Math.round(limit / 1_000)}K`
  return String(limit)
}

function formatCost(cost: { input?: number; output?: number } | undefined): string {
  if (!cost) return ""
  const parts: string[] = []
  if (cost.input != null) parts.push(`$${cost.input}/Mi`)
  if (cost.output != null) parts.push(`$${cost.output}/Mo`)
  return parts.join(" ")
}

export function ModelCombobox({ value, onChange, repoId, placeholder = "留空使用默认模型" }: ModelComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Fetch models when dropdown opens for the first time (or repoId changes)
  const fetchedRepoRef = useRef<string | null>(null)
  const fetchModels = useCallback(async (rid: string) => {
    setLoading(true)
    try {
      const result = await listModels(rid)
      setModels(result)
    } catch {
      setModels([])
    } finally {
      setLoading(false)
      setFetched(true)
      fetchedRepoRef.current = rid
    }
  }, [])

  // Reset on repoId change
  useEffect(() => {
    if (repoId !== fetchedRepoRef.current) {
      setFetched(false)
      setModels([])
    }
  }, [repoId])

  const handleOpen = () => {
    if (!open) {
      setOpen(true)
      setQuery("")
      setHighlightIdx(-1)
      if (repoId && (!fetched || fetchedRepoRef.current !== repoId)) {
        void fetchModels(repoId)
      }
    }
  }

  // Filter models by query
  const filtered = useMemo(() => {
    if (!query.trim()) return models
    const q = query.toLowerCase()
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.providerName.toLowerCase().includes(q),
    )
  }, [models, query])

  const grouped = useMemo(() => groupByProvider(filtered), [filtered])

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => filtered, [filtered])

  // Click outside to close
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${highlightIdx}"]`)
    if (el) el.scrollIntoView({ block: "nearest" })
  }, [highlightIdx])

  const selectModel = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery("")
    inputRef.current?.blur()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault()
        handleOpen()
      }
      return
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setHighlightIdx((prev) => (prev < flatItems.length - 1 ? prev + 1 : 0))
        break
      case "ArrowUp":
        e.preventDefault()
        setHighlightIdx((prev) => (prev > 0 ? prev - 1 : flatItems.length - 1))
        break
      case "Enter":
        e.preventDefault()
        if (highlightIdx >= 0 && highlightIdx < flatItems.length) {
          selectModel(flatItems[highlightIdx].id)
        } else if (query.trim()) {
          // Free text input — accept whatever user typed
          selectModel(query.trim())
        }
        break
      case "Escape":
        e.preventDefault()
        setOpen(false)
        setQuery("")
        break
    }
  }

  const displayValue = open ? query : value

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          placeholder={placeholder}
          onFocus={handleOpen}
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlightIdx(-1)
            if (!open) handleOpen()
          }}
          onKeyDown={handleKeyDown}
          className="mt-1 w-full rounded-md border border-line bg-surface py-1.5 pl-3 pr-16 font-mono text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none"
        />
        <div className="absolute inset-y-0 right-0 mt-1 flex items-center gap-0.5 pr-2">
          {value && !open && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(""); inputRef.current?.focus() }}
              className="rounded p-0.5 text-fg-5 hover:text-fg-3"
              tabIndex={-1}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => { if (open) setOpen(false); else { handleOpen(); inputRef.current?.focus() } }}
            className="rounded p-0.5 text-fg-5 hover:text-fg-3"
            tabIndex={-1}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 fs-spin" /> : <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />}
          </button>
        </div>
      </div>

      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface shadow-lg"
        >
          {!repoId ? (
            <div className="px-3 py-4 text-center text-xs text-fg-5">
              请先选择一个仓库以加载可用模型，或直接输入模型 ID
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-fg-5">
              <Loader2 className="h-3.5 w-3.5 fs-spin" />
              加载模型列表…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-fg-5">
              {query ? (
                <>
                  无匹配模型 —{" "}
                  <button type="button" onClick={() => selectModel(query.trim())} className="text-blue-400 hover:underline">
                    使用 "{query.trim()}"
                  </button>
                </>
              ) : (
                "暂无可用模型"
              )}
            </div>
          ) : (
            <>
              {grouped.map((group) => (
                <div key={group.provider}>
                  <div className="sticky top-0 bg-elevated px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-5">
                    {group.provider}
                  </div>
                  {group.models.map((m) => {
                    const idx = flatItems.indexOf(m)
                    const isHighlighted = idx === highlightIdx
                    const isSelected = m.id === value
                    const ctx = formatContext(m.contextLimit)
                    const cost = formatCost(m.cost)
                    return (
                      <button
                        key={m.id}
                        type="button"
                        data-idx={idx}
                        onClick={() => selectModel(m.id)}
                        className={clsx(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                          isHighlighted && "bg-blue-500/10",
                          isSelected && !isHighlighted && "bg-elevated",
                          !isHighlighted && !isSelected && "hover:bg-elevated",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{m.name || m.id}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          {ctx && <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-fg-5">{ctx}</span>}
                          {cost && <span className="text-[10px] text-fg-6">{cost}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
              {query.trim() && !filtered.some((m) => m.id === query.trim()) && (
                <div className="border-t border-line px-3 py-2 text-xs text-fg-5">
                  按 Enter 使用自定义模型 "<span className="font-mono text-fg-4">{query.trim()}</span>"
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

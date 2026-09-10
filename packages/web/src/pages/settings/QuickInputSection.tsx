import { useEffect, useState } from "react"
import { ChevronDown, ChevronUp, Keyboard, Plus, Save, Trash2 } from "lucide-react"
import * as api from "../../lib/api-client"

interface QuickInput {
  label: string
  text: string
  autoSend?: boolean
}

function QuickInputSection() {
  const [items, setItems] = useState<QuickInput[]>([])
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const settings = await api.getSettings()
        if (cancelled) return
        const raw = settings.quick_inputs
        if (raw) {
          try { setItems(JSON.parse(raw)) } catch { /* ignore bad JSON */ }
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const valid = items.filter(i => i.label.trim() && i.text.trim())
      await api.updateSetting("quick_inputs", JSON.stringify(valid))
      setItems(valid)
    } finally {
      setSaving(false)
    }
  }

  const addItem = () => {
    setItems([...items, { label: "", text: "", autoSend: true }])
  }

  const updateItem = (index: number, updates: Partial<QuickInput>) => {
    setItems(items.map((item, i) => i === index ? { ...item, ...updates } : item))
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    setItems(next)
  }

  if (!loaded) return null

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
          <Keyboard className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">快捷输入</h2>
          <p className="mt-0.5 text-xs text-fg-4">配置常用的快捷输入按钮，显示在对话输入框上方。</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-line bg-base px-3 py-2">
            <div className="flex shrink-0 flex-col gap-0.5">
              <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0} className="text-fg-5 hover:text-fg-3 disabled:opacity-20">
                <ChevronUp className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => moveItem(i, 1)} disabled={i === items.length - 1} className="text-fg-5 hover:text-fg-3 disabled:opacity-20">
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            <input
              type="text"
              value={item.label}
              onChange={(e) => updateItem(i, { label: e.target.value })}
              placeholder="按钮文字"
              className="w-20 min-w-0 rounded border border-line bg-surface px-2 py-1 text-xs text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              value={item.text}
              onChange={(e) => updateItem(i, { text: e.target.value })}
              placeholder="发送内容"
              className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-xs text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none"
            />
            <label className="flex shrink-0 items-center gap-1 text-[11px] text-fg-4">
              <input
                type="checkbox"
                checked={item.autoSend ?? false}
                onChange={(e) => updateItem(i, { autoSend: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-line"
              />
              直接发送
            </label>
            <button type="button" onClick={() => removeItem(i)} className="shrink-0 text-fg-5 transition-colors hover:text-red-400">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={addItem}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-fg-3 transition-colors hover:bg-elevated"
        >
          <Plus className="h-3.5 w-3.5" />
          添加
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      <p className="mt-3 text-[11px] text-fg-5">
        「直接发送」开启后，点击按钮将直接发送消息；关闭则填入输入框供编辑。
      </p>
    </section>
  )
}

export { QuickInputSection }

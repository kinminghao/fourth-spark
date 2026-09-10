import { useEffect, useState } from "react"
import { AlertTriangle, FileText, Loader2, Save } from "lucide-react"
import * as api from "../../lib/api-client"

function AgentsMdSection() {
  const [content, setContent] = useState("")
  const [saved, setSaved] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getGlobalAgentsMd()
      .then((r) => { setContent(r.content); setSaved(r.content); setLoading(false) })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false) })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.updateGlobalAgentsMd(content)
      setSaved(content)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setSaving(false)
  }

  const dirty = content !== saved

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">全局 AGENTS.md</h2>
          <p className="mt-1 text-xs text-fg-4">
            此内容会注入到所有仓库的 Agent 系统指令中。修改后 opencode 热加载，即时生效。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      <div className="mt-4">
        {loading ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-fg-5">
            <Loader2 className="h-5 w-5 fs-spin" />
            <p className="text-xs">加载中…</p>
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="h-96 w-full resize-y rounded-lg border border-line bg-base px-4 py-3 font-mono text-sm leading-relaxed text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="# AGENTS.md&#10;&#10;在此编写全局 Agent 指令…"
          />
        )}
      </div>

      <p className="mt-3 text-[11px] text-fg-5">
        文件路径：~/.config/opencode/AGENTS.md
      </p>
    </section>
  )
}

export { AgentsMdSection }

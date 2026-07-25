import { useEffect, useState } from "react"
import { AlertTriangle, Loader2, Save, X } from "lucide-react"
import * as api from "../lib/api-client"

interface Props {
  repoId: string
  repoName: string
  onClose: () => void
}

export function AgentsMdModal({ repoId, repoName, onClose }: Props) {
  const [content, setContent] = useState("")
  const [saved, setSaved] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getRepoAgentsMd(repoId)
      .then((r) => { setContent(r.content); setSaved(r.content); setLoading(false) })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false) })
  }, [repoId])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.updateRepoAgentsMd(repoId, content)
      setSaved(content)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setSaving(false)
  }

  const dirty = content !== saved

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex w-full max-w-2xl flex-col rounded-xl border border-line bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg">{repoName} — AGENTS.md</h2>
            <p className="mt-0.5 text-xs text-fg-4">仅对此仓库生效，修改后 opencode 热加载即时生效。</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-md p-1 text-fg-4 hover:bg-elevated hover:text-fg-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center gap-2.5 py-16 text-fg-5">
            <Loader2 className="h-5 w-5 fs-spin" />
            <p className="text-xs">加载中…</p>
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="h-96 w-full resize-y rounded-lg border border-line bg-base px-4 py-3 font-mono text-sm leading-relaxed text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="# AGENTS.md&#10;&#10;在此编写该仓库的 Agent 指令…"
          />
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-4 py-2 text-sm text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  )
}

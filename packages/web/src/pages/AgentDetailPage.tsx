import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Check, Clipboard, Download, Loader2, Trash2, X } from "lucide-react"
import clsx from "clsx"
import * as api from "../lib/api-client"
import type { CustomAgent, PromptFragment } from "../lib/api-client"
import { useCustomAgentStore } from "../stores/custom-agent-store"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { agentAvatar } from "../lib/agent-avatar"
import { MemorySection } from "./agent-detail/MemorySection"
import { ConfigSection } from "./agent-detail/ConfigSection"
import { SessionList } from "./agent-detail/SessionList"

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

  const handleSave = async (data: { name: string; baseAgent: string; model?: string; variant?: string; memoryModel?: string | null; systemPrompt?: string; systemPromptPosition?: number; fragmentIds?: string[] }) => {
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
          <div data-guide="agent-detail-actions" className="flex shrink-0 items-center gap-1.5">
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

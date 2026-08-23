import { useEffect, useState, useRef, useCallback, type KeyboardEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Plus, Sparkles } from "lucide-react"
import {
  deleteIssueCreateDraft,
  getIssueCreateDraft,
  getSessionStatus,
  polishIssueCreate,
} from "../lib/api-client"
import { useIssueStore } from "../stores/issue-store"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { useSessionStore } from "../stores/session-store"
import { useToastStore } from "../stores/toast-store"

export function IssueCreateForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<"idle" | "polishing" | "preview">("idle")
  const [polishedTitle, setPolishedTitle] = useState("")
  const [polishedBody, setPolishedBody] = useState("")
  const [polishSessionId, setPolishSessionId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const createIssue = useIssueStore((s) => s.createIssue)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const repoName = useRepoStore(selectActiveRepoName)
  const navigate = useNavigate()

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  useEffect(() => {
    if (!activeRepoId) return
    let cancelled = false
    getIssueCreateDraft(activeRepoId)
      .then((result) => {
        if (!cancelled && result.title) {
          setPolishedTitle(result.title)
          setPolishedBody(result.body)
          setPhase("preview")
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeRepoId])

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    await createIssue(title.trim(), body.trim() || undefined)
    setBusy(false)
    onDone()
  }

  const submitPolished = async () => {
    if (!polishedTitle.trim() || busy) return
    setBusy(true)
    await createIssue(polishedTitle.trim(), polishedBody.trim() || undefined)
    if (activeRepoId) deleteIssueCreateDraft(activeRepoId).catch(() => {})
    setBusy(false)
    setPhase("idle")
    setPolishedTitle("")
    setPolishedBody("")
    setPolishSessionId(null)
    onDone()
  }

  const handlePolish = async () => {
    if (!title.trim() || !activeRepoId || phase === "polishing") return
    setPhase("polishing")
    try {
      const { sessionId } = await polishIssueCreate(activeRepoId, title.trim(), body.trim() || undefined)
      setPolishSessionId(sessionId)

      pollRef.current = setInterval(async () => {
        try {
          const status = await getSessionStatus(activeRepoId, sessionId)
          if (status.type === "idle") {
            stopPolling()
            const result = await getIssueCreateDraft(activeRepoId)
            setPolishedTitle(result.title)
            setPolishedBody(result.body)
            setPhase("preview")
          }
        } catch {
          stopPolling()
          setPhase("idle")
          useToastStore.getState().addToast("润色状态检查失败", "error")
        }
      }, 2000)
    } catch (err) {
      setPhase("idle")
      useToastStore.getState().addToast(err instanceof Error ? err.message : "润色启动失败", "error")
    }
  }

  const handleDiscard = () => {
    stopPolling()
    if (activeRepoId) deleteIssueCreateDraft(activeRepoId).catch(() => {})
    setPolishedTitle("")
    setPolishedBody("")
    setPolishSessionId(null)
    setPhase("idle")
  }

  const handleEscalate = () => {
    if (!polishSessionId || !repoName) return
    useSessionStore.setState({ activeSessionId: polishSessionId })
    navigate(`/${encodeURIComponent(repoName)}/run`)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      void submit()
    }
  }

  if (phase === "preview") {
    return (
      <div className="border-b border-line px-3 py-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-4">
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          AI 润色结果
        </h4>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
          <input
            type="text"
            value={polishedTitle}
            onChange={(e) => setPolishedTitle(e.target.value)}
            className="w-full bg-transparent text-xs font-medium text-fg placeholder:text-fg-6 focus:outline-none"
            placeholder="润色后标题"
          />
          <textarea
            value={polishedBody}
            onChange={(e) => setPolishedBody(e.target.value)}
            rows={5}
            className="mt-2 w-full resize-none bg-transparent text-xs text-fg placeholder:text-fg-6 focus:outline-none"
            placeholder="润色后描述"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={!polishedTitle.trim() || busy}
            onClick={() => void submitPolished()}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            创建 Issue
          </button>
          <button
            type="button"
            onClick={() => void handlePolish()}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-fg-3 transition-colors hover:border-fg-5 hover:text-fg"
          >
            <Sparkles className="h-3.5 w-3.5" />
            重新润色
          </button>
          <button
            type="button"
            onClick={handleEscalate}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-fg-3 transition-colors hover:border-blue-500/50 hover:text-blue-400"
          >
            转入深度对话
          </button>
          <button
            type="button"
            onClick={handleDiscard}
            className="ml-auto rounded-md px-2.5 py-1 text-xs text-fg-5 transition-colors hover:text-fg-3"
          >
            放弃
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="border-b border-line px-3 py-3">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Issue 标题"
        autoFocus
        disabled={phase === "polishing"}
        className="w-full rounded-md border border-line bg-base px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-6 focus:border-fg-5 focus:outline-none disabled:opacity-50"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="描述（可选）  ⌘⏎ 创建"
        rows={3}
        disabled={phase === "polishing"}
        className="mt-2 w-full resize-none rounded-md border border-line bg-base px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-6 focus:border-fg-5 focus:outline-none disabled:opacity-50"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-2.5 py-1 text-xs text-fg-4 transition-colors hover:text-fg-2"
        >
          取消
        </button>
        <button
          type="button"
          disabled={!title.trim() || phase === "polishing"}
          onClick={() => void handlePolish()}
          className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {phase === "polishing" ? "润色中..." : "AI 润色"}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!title.trim() || busy || phase === "polishing"}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          直接创建
        </button>
      </div>
    </div>
  )
}

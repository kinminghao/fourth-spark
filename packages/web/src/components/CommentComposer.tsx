import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Send, Sparkles } from "lucide-react"
import { createIssueComment, getDraft, getSessionStatus, polishComment, type IssueComment } from "../lib/api-client"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { useSessionStore } from "../stores/session-store"
import { useToastStore } from "../stores/toast-store"

export function CommentComposer({
  repoId,
  issueNumber,
  onPublished,
}: {
  repoId: string
  issueNumber: number
  onPublished: (comment: IssueComment) => void
}) {
  const navigate = useNavigate()
  const repoName = useRepoStore(selectActiveRepoName)

  const [draft, setDraft] = useState("")
  const [phase, setPhase] = useState<"idle" | "polishing" | "preview">("idle")
  const [polishedBody, setPolishedBody] = useState("")
  const [polishSessionId, setPolishSessionId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  useEffect(() => {
    let cancelled = false
    getDraft(repoId, issueNumber)
      .then((result) => {
        if (!cancelled && result.body) {
          setPolishedBody(result.body)
          setPhase("preview")
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [repoId, issueNumber])

  const handleDirectSend = async () => {
    if (!draft.trim() || busy) return
    setBusy(true)
    try {
      const comment = await createIssueComment(repoId, issueNumber, draft.trim())
      onPublished(comment)
      setDraft("")
      useToastStore.getState().addToast("评论已发布", "success")
    } catch (err) {
      useToastStore.getState().addToast(err instanceof Error ? err.message : "发布失败", "error")
    } finally {
      setBusy(false)
    }
  }

  const handlePolish = async () => {
    if (!draft.trim() || phase === "polishing") return
    setPhase("polishing")
    try {
      const { sessionId } = await polishComment(repoId, issueNumber, draft.trim())
      setPolishSessionId(sessionId)

      pollRef.current = setInterval(async () => {
        try {
          const status = await getSessionStatus(repoId, sessionId)
          if (status.type === "idle") {
            stopPolling()
            const result = await getDraft(repoId, issueNumber)
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

  const handlePublishPolished = async () => {
    if (!polishedBody.trim() || busy) return
    setBusy(true)
    try {
      const comment = await createIssueComment(repoId, issueNumber, polishedBody.trim())
      onPublished(comment)
      setDraft("")
      setPolishedBody("")
      setPolishSessionId(null)
      setPhase("idle")
      useToastStore.getState().addToast("评论已发布", "success")
    } catch (err) {
      useToastStore.getState().addToast(err instanceof Error ? err.message : "发布失败", "error")
    } finally {
      setBusy(false)
    }
  }

  const handleDiscard = () => {
    stopPolling()
    setPolishedBody("")
    setPolishSessionId(null)
    setPhase("idle")
  }

  const handleEscalate = () => {
    if (!polishSessionId || !repoName) return
    useSessionStore.setState({ activeSessionId: polishSessionId })
    navigate(`/${encodeURIComponent(repoName)}/run`)
  }

  if (phase === "preview") {
    return (
      <div className="mt-8 border-t border-line pt-6">
        <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-4">
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          AI 润色结果
        </h3>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <textarea
            value={polishedBody}
            onChange={(e) => setPolishedBody(e.target.value)}
            rows={6}
            className="w-full resize-none bg-transparent text-sm text-fg placeholder:text-fg-6 focus:outline-none"
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handlePublishPolished()}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            发布评论
          </button>
          <button
            type="button"
            onClick={() => void handlePolish()}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-3 transition-colors hover:border-fg-5 hover:text-fg"
          >
            <Sparkles className="h-3.5 w-3.5" />
            重新润色
          </button>
          <button
            type="button"
            onClick={handleEscalate}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-3 transition-colors hover:border-blue-500/50 hover:text-blue-400"
          >
            转入深度对话
          </button>
          <button
            type="button"
            onClick={handleDiscard}
            className="ml-auto rounded-md px-2.5 py-1.5 text-xs text-fg-5 transition-colors hover:text-fg-3"
          >
            放弃
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8 border-t border-line pt-6">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-4">
        添加评论
      </h3>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="写下你的评论..."
        rows={4}
        disabled={phase === "polishing"}
        className="w-full resize-none rounded-lg border border-line bg-base px-3 py-2.5 text-sm text-fg placeholder:text-fg-6 focus:border-fg-5 focus:outline-none disabled:opacity-50"
      />
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          disabled={!draft.trim() || busy || phase === "polishing"}
          onClick={() => void handleDirectSend()}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
          {busy ? "发送中..." : "直接发送"}
        </button>
        <button
          type="button"
          disabled={!draft.trim() || phase === "polishing"}
          onClick={() => void handlePolish()}
          className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {phase === "polishing" ? "润色中..." : "AI 润色"}
        </button>
      </div>
    </div>
  )
}

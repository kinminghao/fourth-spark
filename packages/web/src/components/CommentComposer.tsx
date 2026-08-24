import { useCallback, useEffect, useRef, useState } from "react"
import { Ellipsis, Send, Sparkles } from "lucide-react"
import { createIssueComment, getDraft, polishComment, type IssueComment } from "../lib/api-client"
import { useAiPolish } from "../hooks/use-ai-polish"
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
  const [draft, setDraft] = useState("")
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  const startPolish = useCallback(
    () => polishComment(repoId, issueNumber, draft.trim()),
    [repoId, issueNumber, draft],
  )
  const fetchResult = useCallback(
    () => getDraft(repoId, issueNumber).then((r) => r.body),
    [repoId, issueNumber],
  )
  const loadExisting = useCallback(
    () => getDraft(repoId, issueNumber).then((r) => r.body || null),
    [repoId, issueNumber],
  )

  const {
    phase, result: polishedBody, busy, setBusy,
    polish, discard, escalate, setResult: setPolishedBody,
  } = useAiPolish<string>({ repoId, startPolish, fetchResult, loadExisting })

  useEffect(() => {
    if (!moreOpen) return
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [moreOpen])

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

  const handlePublishPolished = async () => {
    if (!polishedBody?.trim() || busy) return
    setBusy(true)
    try {
      const comment = await createIssueComment(repoId, issueNumber, polishedBody.trim())
      onPublished(comment)
      setDraft("")
      discard()
      useToastStore.getState().addToast("评论已发布", "success")
    } catch (err) {
      useToastStore.getState().addToast(err instanceof Error ? err.message : "发布失败", "error")
    } finally {
      setBusy(false)
    }
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
            value={polishedBody ?? ""}
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
            onClick={discard}
            className="ml-auto rounded-md px-2.5 py-1.5 text-xs text-fg-5 transition-colors hover:text-fg-3"
          >
            放弃
          </button>
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              onClick={() => setMoreOpen(!moreOpen)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
            >
              <Ellipsis className="h-3.5 w-3.5" />
            </button>
            {moreOpen && (
              <div className="absolute right-0 bottom-full z-20 mb-1 min-w-[140px] overflow-hidden rounded-lg border border-line bg-elevated shadow-lg">
                <button
                  type="button"
                  onClick={() => { setMoreOpen(false); void polish() }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-fg-3 transition-colors hover:bg-base/60"
                >
                  <Sparkles className="h-3 w-3" />
                  重新润色
                </button>
                <button
                  type="button"
                  onClick={() => { setMoreOpen(false); escalate() }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-fg-3 transition-colors hover:bg-base/60"
                >
                  转入深度对话
                </button>
              </div>
            )}
          </div>
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
          onClick={() => void polish()}
          className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {phase === "polishing" ? "润色中..." : "AI 润色"}
        </button>
      </div>
    </div>
  )
}

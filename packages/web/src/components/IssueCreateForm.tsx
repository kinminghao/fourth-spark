import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Ellipsis, Plus, Sparkles } from "lucide-react"
import {
  deleteIssueCreateDraft,
  getIssueCreateDraft,
  polishIssueCreate,
} from "../lib/api-client"
import { useIssueStore } from "../stores/issue-store"
import { useRepoStore } from "../stores/repo-store"
import { useAiPolish } from "../hooks/use-ai-polish"

interface CreateDraft {
  title: string
  body: string
}

export function IssueCreateForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const createIssue = useIssueStore((s) => s.createIssue)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)

  const startPolish = useCallback(
    () => polishIssueCreate(activeRepoId!, title.trim(), body.trim() || undefined),
    [activeRepoId, title, body],
  )
  const fetchResult = useCallback(
    () => getIssueCreateDraft(activeRepoId!),
    [activeRepoId],
  )
  const loadExisting = useCallback(
    () => getIssueCreateDraft(activeRepoId!).then((r) => r.title ? r : null),
    [activeRepoId],
  )
  const cleanup = useCallback(
    () => deleteIssueCreateDraft(activeRepoId!),
    [activeRepoId],
  )

  const {
    phase, result: polished, busy, setBusy,
    polish, discard, escalate, setResult: setPolished,
  } = useAiPolish<CreateDraft>({ repoId: activeRepoId, startPolish, fetchResult, loadExisting, cleanup })

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

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    await createIssue(title.trim(), body.trim() || undefined)
    setBusy(false)
    onDone()
  }

  const submitPolished = async () => {
    if (!polished?.title.trim() || busy) return
    setBusy(true)
    await createIssue(polished.title.trim(), polished.body.trim() || undefined)
    setBusy(false)
    discard()
    onDone()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      void submit()
    }
  }

  if (phase === "preview" && polished) {
    return (
      <div className="border-b border-line px-3 py-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-4">
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          AI 润色结果
        </h4>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
          <input
            type="text"
            value={polished.title}
            onChange={(e) => setPolished({ ...polished, title: e.target.value })}
            className="w-full bg-transparent text-xs font-medium text-fg placeholder:text-fg-6 focus:outline-none"
            placeholder="润色后标题"
          />
          <textarea
            value={polished.body}
            onChange={(e) => setPolished({ ...polished, body: e.target.value })}
            rows={5}
            className="mt-2 w-full resize-none bg-transparent text-xs text-fg placeholder:text-fg-6 focus:outline-none"
            placeholder="润色后描述"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={!polished.title.trim() || busy}
            onClick={() => void submitPolished()}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            创建 Issue
          </button>
          <button
            type="button"
            onClick={discard}
            className="ml-auto rounded-md px-2.5 py-1 text-xs text-fg-5 transition-colors hover:text-fg-3"
          >
            放弃
          </button>
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              onClick={() => setMoreOpen(!moreOpen)}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-line text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
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
          onClick={() => void polish()}
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

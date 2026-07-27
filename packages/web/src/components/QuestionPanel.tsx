import { useState } from "react"
import clsx from "clsx"
import { Check, MessageCircleQuestion, Send, X } from "lucide-react"
import type { MessagePart } from "../lib/api-client"
import {
  getQuestions,
  getToolStatus,
  type QuestionData,
} from "../lib/message-parts"
import { useSessionStore } from "../stores/session-store"
import { useToastStore } from "../stores/toast-store"

function QuestionCard({
  q,
  pending,
  selected,
  onSelect,
}: {
  q: QuestionData
  pending: boolean
  selected?: string[]
  onSelect: (label: string) => void
}) {
  return (
    <div className="space-y-2">
      {q.header && (
        <div className="text-xs font-semibold text-fg-3">{q.header}</div>
      )}
      <p className="text-sm text-fg-2">{q.question}</p>
      {q.options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {q.options.map((opt) => {
            const isSelected = selected?.includes(opt.label) ?? false
            return (
              <button
                key={opt.label}
                type="button"
                disabled={!pending}
                onClick={() => onSelect(opt.label)}
                className={clsx(
                  "rounded-md border px-3 py-1.5 text-left text-xs transition-colors",
                  isSelected
                    ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30"
                    : pending
                      ? "border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
                      : "border-line bg-surface/50 text-fg-5 cursor-default",
                )}
              >
                {isSelected && <Check className="mr-1 inline h-3 w-3" />}
                <span className="font-medium">{opt.label}</span>
                {opt.description && (
                  <span className="ml-1.5 text-fg-5">{opt.description}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function QuestionPanel({ part }: { part: MessagePart }) {
  const questions = getQuestions(part)
  const status = getToolStatus(part)
  const pending = status === "pending" || status === "running"
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sendMessage = useSessionStore((s) => s.sendMessage)
  const abortSession = useSessionStore((s) => s.abortSession)
  const [resolved, setResolved] = useState<"answered" | "dismissed" | null>(null)
  const [selections, setSelections] = useState<Record<number, string[]>>({})

  if (!questions || questions.length === 0) return null

  const isSingle = questions.length === 1

  const clearToast = () => {
    if (activeSessionId) useToastStore.getState().removeToast(`question-${activeSessionId}`)
  }

  const handleSelect = (questionIndex: number, label: string) => {
    if (resolved) return

    if (isSingle) {
      // Single question: send immediately (preserves existing behavior)
      setResolved("answered")
      clearToast()
      void sendMessage(label)
      return
    }

    // Multiple questions: track selection per question
    setSelections((prev) => {
      const q = questions[questionIndex]
      const current = prev[questionIndex] ?? []

      if (q.multiple) {
        // Multi-select: toggle the option
        const isSelected = current.includes(label)
        return {
          ...prev,
          [questionIndex]: isSelected
            ? current.filter((l) => l !== label)
            : [...current, label],
        }
      }
      // Single-select: replace
      return { ...prev, [questionIndex]: [label] }
    })
  }

  const answeredCount = questions.filter(
    (_, i) => (selections[i]?.length ?? 0) > 0,
  ).length
  const allAnswered = !isSingle && answeredCount === questions.length

  const handleSubmitAll = () => {
    if (resolved || !allAnswered) return
    setResolved("answered")
    clearToast()

    const answers = questions.map((_, i) => {
      const sel = selections[i] ?? []
      return sel.length === 1 ? sel[0] : sel
    })
    void sendMessage(JSON.stringify(answers))
  }

  const handleDismiss = () => {
    if (resolved) return
    setResolved("dismissed")
    clearToast()
    void abortSession()
  }

  const active = pending && !resolved

  return (
    <div
      className={clsx(
        "my-1 overflow-hidden rounded-md border bg-term/70",
        active ? "border-blue-500/40" : "border-line",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 font-mono text-xs">
        <MessageCircleQuestion
          className={clsx("h-3.5 w-3.5 shrink-0", active ? "text-blue-400" : "text-fg-4")}
        />
        <span className={clsx("font-medium", active ? "text-blue-300" : "text-fg-3")}>
          {resolved === "answered" ? "已回复" : resolved === "dismissed" ? "已取消" : active ? "等待回复" : "Question"}
        </span>
        {!isSingle && active && (
          <span className="text-fg-5">
            ({answeredCount}/{questions.length})
          </span>
        )}
        {active && (
          <button
            type="button"
            onClick={handleDismiss}
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-fg-5 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <X className="h-3 w-3" />
            <span>取消</span>
          </button>
        )}
      </div>

      <div className="border-t border-line px-4 py-3 space-y-3">
        {questions.map((q, i) => (
          <QuestionCard
            key={i}
            q={q}
            pending={active}
            selected={selections[i]}
            onSelect={(label) => handleSelect(i, label)}
          />
        ))}
        {!isSingle && active && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              disabled={!allAnswered}
              onClick={handleSubmitAll}
              className={clsx(
                "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-medium transition-colors",
                allAnswered
                  ? "bg-emerald-600 text-white hover:bg-emerald-500"
                  : "bg-surface/50 text-fg-5 cursor-not-allowed",
              )}
            >
              <Send className="h-3 w-3" />
              <span>提交回答</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

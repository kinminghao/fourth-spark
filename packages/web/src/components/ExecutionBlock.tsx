import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"
import clsx from "clsx"
import { AlertTriangle, Brain, ChevronDown, ChevronRight, Paperclip } from "lucide-react"
import type { Message, MessagePart } from "../lib/api-client"
import { classifyPart, getPartText, isQuestionTool } from "../lib/message-parts"
import { PreviewableImage } from "./Attachments"
import { MarkdownTable } from "./MarkdownTable"
import { QuestionPanel } from "./QuestionPanel"
import { ToolCallPanel } from "./ToolCallPanel"

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 font-mono text-xs text-fg-5 transition-colors hover:text-fg-3"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <Brain className="h-3 w-3 shrink-0" />
        <span>thinking</span>
      </button>
      {open && (
        <div className="ml-1.5 mt-1 whitespace-pre-wrap border-l border-line pl-3 text-xs italic leading-relaxed text-fg-4">
          {text}
        </div>
      )}
    </div>
  )
}

function ThinkingIndicator() {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="my-1 flex items-center gap-1.5 font-mono text-xs text-fg-5">
      <Brain className="h-3 w-3 shrink-0 animate-pulse" />
      <span>thinking</span>
      {elapsed > 0 && <span className="text-fg-6">{elapsed}s</span>}
    </div>
  )
}

function AttachmentView({ part, className }: { part: MessagePart; className?: string }) {
  if (!part.url) {
    return null
  }
  if (!part.mime?.startsWith("image/")) {
    return (
      <div className="flex items-center gap-1.5 font-mono text-xs text-fg-5">
        <Paperclip className="h-3 w-3 shrink-0" />
        <span>{part.filename ?? part.mime ?? "attachment"}</span>
      </div>
    )
  }
  return (
    <PreviewableImage
      url={part.url}
      label={part.filename ?? "attachment"}
      className={clsx("object-contain", className ?? "max-h-80")}
    />
  )
}

function PartView({ part, isStreaming }: { part: MessagePart; isStreaming?: boolean }) {
  const kind = classifyPart(part)
  switch (kind) {
    case "text": {
      const text = getPartText(part)
      if (!text.trim()) {
        return null
      }
      return (
        <div className="markdown-body leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ table: MarkdownTable }}>{text}</ReactMarkdown>
        </div>
      )
    }
    case "thinking": {
      const text = getPartText(part)
      if (!text.trim()) {
        return isStreaming ? <ThinkingIndicator /> : null
      }
      return <ThinkingBlock text={text} />
    }
    case "tool":
      if (isQuestionTool(part)) return <QuestionPanel part={part} />
      return <ToolCallPanel part={part} />
    case "file":
      return <AttachmentView part={part} />
    default:
      return null
  }
}

export function ExecutionBlock({ message, isStreaming, queued }: { message: Message; isStreaming?: boolean; queued?: boolean }) {
  const isUser = message.role === "user"
  const parts = message.parts ?? []
  const renderable = parts.filter((part) => classifyPart(part) !== "other")

  if (isUser) {
    const prompt = parts.map(getPartText).join("").trim()
    const attachments = parts.filter((part) => classifyPart(part) === "file")
    const createdAt = message.time?.created
    const timeStr = createdAt
      ? new Date(createdAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null
    return (
      <div className="fs-fade-in rounded-r-md border-l-2 border-emerald-500/40 bg-emerald-500/[0.04] px-3 py-2 font-mono">
        <div className="mb-1 flex items-center gap-2 text-[11px]">
          <span className="font-medium text-emerald-400">You</span>
          {timeStr && (
            <>
              <span className="text-fg-6">·</span>
              <span className="text-fg-5">{timeStr}</span>
            </>
          )}
          {queued && (
            <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 px-1.5 py-0.5 text-xs text-amber-400">
              <span className="leading-none">○</span>
              <span>queued</span>
            </span>
          )}
        </div>
        <div className="flex items-start gap-2 text-sm">
          <span className="shrink-0 select-none text-emerald-400">❯</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-fg">
            {prompt || "…"}
          </span>
        </div>
        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 pl-5">
            {attachments.map((part, index) => (
              <AttachmentView key={part.id ?? index} part={part} className="max-h-40" />
            ))}
          </div>
        )}
      </div>
    )
  }

  const agent = message.info?.agent ?? message.agent
  const model = message.info?.modelID ?? message.modelID
  const msgError = message.info?.error
  const msgFinish = message.info?.finish

  return (
    <div className="fs-fade-in font-mono">
      {(agent || model) && (
        <div className="mb-1 flex items-center gap-2 text-xs">
          {agent && <span className="text-fg-3">{agent}</span>}
          {agent && model && <span className="text-fg-6">·</span>}
          {model && <span className="text-fg-5">{model}</span>}
        </div>
      )}
      {msgError && (
        <div className="my-1 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <span className="font-semibold">{msgError.name ?? "Error"}</span>
            {msgError.data?.message && (
              <p className="mt-0.5 text-red-400/80">{msgError.data.message}</p>
            )}
            {msgFinish && msgFinish !== "end" && (
              <p className="mt-0.5 text-red-400/60">finish: {msgFinish}</p>
            )}
          </div>
        </div>
      )}
      <div className="space-y-2 text-sm text-fg">
        {renderable.length > 0 ? (
          renderable.map((part, index) => (
            <PartView key={part.id ?? part.callID ?? index} part={part} isStreaming={isStreaming} />
          ))
        ) : (
          !msgError && (
            isStreaming
              ? <span className="text-fg-5">…</span>
              : <div className="flex items-center gap-1.5 text-xs text-amber-400/80">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  <span>空响应 — Agent 未产出任何内容</span>
                </div>
          )
        )}
      </div>
    </div>
  )
}

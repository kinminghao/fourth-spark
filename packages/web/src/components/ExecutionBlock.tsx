import { useState } from "react"
import ReactMarkdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"
import { Brain, ChevronDown, ChevronRight } from "lucide-react"
import type { Message, MessagePart } from "../lib/api-client"
import { classifyPart, getPartText, isQuestionTool } from "../lib/message-parts"
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

function PartView({ part }: { part: MessagePart }) {
  const kind = classifyPart(part)
  switch (kind) {
    case "text": {
      const text = getPartText(part)
      if (!text.trim()) {
        return null
      }
      return (
        <div className="markdown-body leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{text}</ReactMarkdown>
        </div>
      )
    }
    case "thinking": {
      const text = getPartText(part)
      if (!text.trim()) {
        return null
      }
      return <ThinkingBlock text={text} />
    }
    case "tool":
      if (isQuestionTool(part)) return <QuestionPanel part={part} />
      return <ToolCallPanel part={part} />
    default:
      return null
  }
}

export function ExecutionBlock({ message }: { message: Message }) {
  const isUser = message.role === "user"
  const parts = message.parts ?? []
  const renderable = parts.filter((part) => classifyPart(part) !== "other")

  if (isUser) {
    const prompt = parts.map(getPartText).join("").trim()
    return (
      <div className="fs-fade-in flex gap-2 font-mono text-sm">
        <span className="shrink-0 select-none text-emerald-400">❯</span>
        <span className="min-w-0 whitespace-pre-wrap break-words text-fg-2">
          {prompt || "…"}
        </span>
      </div>
    )
  }

  const agent = message.info?.agent ?? message.agent
  const model = message.info?.modelID ?? message.modelID

  return (
    <div className="fs-fade-in font-mono">
      {(agent || model) && (
        <div className="mb-1 flex items-center gap-2 text-xs">
          {agent && <span className="text-fg-3">{agent}</span>}
          {agent && model && <span className="text-fg-6">·</span>}
          {model && <span className="text-fg-5">{model}</span>}
        </div>
      )}
      <div className="space-y-2 text-sm text-fg">
        {renderable.length > 0 ? (
          renderable.map((part, index) => (
            <PartView key={part.id ?? part.callID ?? index} part={part} />
          ))
        ) : (
          <span className="text-fg-5">…</span>
        )}
      </div>
    </div>
  )
}

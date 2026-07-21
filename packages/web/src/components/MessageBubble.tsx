import { useState } from "react"
import ReactMarkdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import { Brain, ChevronDown, ChevronRight } from "lucide-react"
import clsx from "clsx"
import type { Message, MessagePart } from "../lib/api-client"
import { classifyPart, getPartText } from "../lib/message-parts"
import { ToolCallPanel } from "./ToolCallPanel"

function formatTime(message: Message): string | null {
  const created = message.time?.created
  if (typeof created !== "number") {
    return null
  }
  // Timestamps may arrive as seconds or milliseconds; normalize to ms.
  const ms = created < 1_000_000_000_000 ? created * 1000 : created
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1.5 rounded-lg border border-zinc-800/70 bg-zinc-900/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-500 transition-colors hover:text-zinc-300"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        <Brain className="h-3.5 w-3.5 shrink-0" />
        <span>Thinking</span>
      </button>
      {open && (
        <div className="whitespace-pre-wrap px-3 pb-2 pl-9 text-xs italic leading-5 text-zinc-500">
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
        <div className="markdown-body">
          <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{text}</ReactMarkdown>
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
      return <ToolCallPanel part={part} />
    case "other":
      return null
    default:
      return null
  }
}

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user"
  const parts = message.parts ?? []
  const agent = message.info?.agent ?? message.agent
  const model = message.info?.modelID ?? message.modelID
  const time = formatTime(message)
  const renderable = parts.filter((part) => classifyPart(part) !== "other")

  return (
    <div
      className={clsx(
        "fs-fade-in flex w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={clsx(
          "flex max-w-[85%] flex-col gap-1",
          isUser ? "items-end" : "items-start",
        )}
      >
        {!isUser && (agent || model) && (
          <div className="flex items-center gap-1.5 px-1 text-xs">
            {agent && <span className="font-medium text-zinc-400">{agent}</span>}
            {model && <span className="text-zinc-600">{model}</span>}
          </div>
        )}
        <div
          className={clsx(
            "rounded-xl px-4 py-2.5 text-sm",
            isUser
              ? "bg-blue-600 text-white"
              : "border border-zinc-800 bg-zinc-900 text-zinc-100",
          )}
        >
          {renderable.length > 0 ? (
            <div className="space-y-1">
              {renderable.map((part, index) => (
                <PartView
                  key={part.id ?? part.callID ?? index}
                  part={part}
                />
              ))}
            </div>
          ) : (
            <span className="italic text-zinc-500">…</span>
          )}
        </div>
        {time && <span className="px-1 text-[10px] text-zinc-600">{time}</span>}
      </div>
    </div>
  )
}

import { useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Loader2,
  Wrench,
  XCircle,
} from "lucide-react"
import type { MessagePart } from "../lib/api-client"
import {
  formatToolPayload,
  getToolInput,
  getToolName,
  getToolOutput,
  getToolStatus,
  type ToolStatus,
} from "../lib/message-parts"

const OUTPUT_TRUNCATE_LIMIT = 2000

function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
    case "error":
      return <XCircle className="h-3.5 w-3.5 text-red-400" />
    case "pending":
      return <Circle className="h-3.5 w-3.5 text-zinc-500" />
    default:
      return <Circle className="h-3.5 w-3.5 text-zinc-500" />
  }
}

export function ToolCallPanel({ part }: { part: MessagePart }) {
  const [open, setOpen] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(false)

  const name = getToolName(part)
  const status = getToolStatus(part)
  const input = formatToolPayload(getToolInput(part))
  const output = formatToolPayload(getToolOutput(part))

  const outputTooLong = output.length > OUTPUT_TRUNCATE_LIMIT
  const shownOutput =
    outputExpanded || !outputTooLong
      ? output
      : `${output.slice(0, OUTPUT_TRUNCATE_LIMIT)}…`

  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-200 hover:bg-zinc-800/60"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
        )}
        <Wrench className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <span className="truncate font-mono text-xs text-zinc-200">{name}</span>
        <span className="ml-auto shrink-0">
          <StatusIcon status={status} />
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-3 py-2 text-xs">
          {input && (
            <section className="mb-2">
              <div className="mb-1 font-medium uppercase tracking-wide text-zinc-500">
                Input
              </div>
              <pre className="overflow-x-auto rounded-md bg-zinc-950/80 p-2 font-mono text-zinc-300">
                {input}
              </pre>
            </section>
          )}
          {output && (
            <section>
              <div className="mb-1 font-medium uppercase tracking-wide text-zinc-500">
                Output
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-zinc-950/80 p-2 font-mono text-zinc-300">
                {shownOutput}
              </pre>
              {outputTooLong && (
                <button
                  type="button"
                  onClick={() => setOutputExpanded((value) => !value)}
                  className="mt-1 text-blue-400 transition-colors hover:text-blue-300"
                >
                  {outputExpanded
                    ? "Show less"
                    : `Show ${output.length - OUTPUT_TRUNCATE_LIMIT} more chars`}
                </button>
              )}
            </section>
          )}
          {!input && !output && (
            <div className="text-zinc-500">No parameters</div>
          )}
        </div>
      )}
    </div>
  )
}

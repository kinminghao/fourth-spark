import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { Send } from "lucide-react"
import clsx from "clsx"
import { useSessionStore } from "../stores/session-store"

const MAX_HEIGHT_PX = 144

export function InputBar() {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const status = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? state.sessionStatuses.get(id) : undefined
  })
  const sendMessage = useSessionStore((state) => state.sendMessage)

  const busy = status === "busy"
  const disabled = !activeSessionId || busy

  // Auto-resize the textarea between 1 and ~6 rows as content changes.
  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) {
      return
    }
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

  // Clear the draft when switching sessions.
  useEffect(() => {
    setValue("")
  }, [activeSessionId])

  const submit = () => {
    const text = value.trim()
    if (!text || disabled) {
      return
    }
    void sendMessage(text)
    setValue("")
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      submit()
    }
  }

  const placeholder = !activeSessionId
    ? "Select or create a session"
    : busy
      ? "Agent is working…"
      : "Send a message…  (⌘/Ctrl + Enter)"

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 p-3">
      <div
        className={clsx(
          "flex items-end gap-2 rounded-xl border bg-zinc-900 px-3 py-2 transition-colors duration-200",
          disabled
            ? "border-zinc-800 opacity-60"
            : "border-zinc-700 focus-within:border-blue-500",
        )}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 resize-none bg-transparent text-sm leading-6 text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || value.trim().length === 0}
          aria-label="Send message"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors duration-200 hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

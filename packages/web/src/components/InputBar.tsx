import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { CornerDownLeft } from "lucide-react"
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

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) {
      return
    }
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

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
    ? "select or start a run"
    : busy
      ? "agent is running…"
      : "enter a command…"

  const promptColor = !activeSessionId
    ? "text-zinc-700"
    : busy
      ? "text-amber-400 fs-blink"
      : "text-emerald-400"

  return (
    <div className="border-t border-line bg-term px-4 py-3">
      <div
        className={clsx(
          "mx-auto flex max-w-4xl items-start gap-2 border-b pb-1 transition-colors duration-150",
          disabled
            ? "border-transparent"
            : "border-line focus-within:border-zinc-600",
        )}
      >
        <span className={clsx("select-none pt-px font-mono text-sm leading-6", promptColor)}>
          ❯
        </span>
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 resize-none bg-transparent font-mono text-sm leading-6 text-zinc-100 placeholder:text-zinc-700 focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || value.trim().length === 0}
          aria-label="Send message"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors duration-150 hover:bg-zinc-800 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
        >
          <CornerDownLeft className="h-4 w-4" />
        </button>
      </div>
      <div className="mx-auto mt-1.5 max-w-4xl pl-5 font-mono text-[10px] text-zinc-700">
        ⌘⏎ / ctrl+⏎ to run · shift+⏎ for newline
      </div>
    </div>
  )
}

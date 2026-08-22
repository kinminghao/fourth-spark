import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { useSpeechToText } from "./use-speech-to-text"

const VOICE_TEXTAREA_MAX_HEIGHT_PX = 240
const TICK_INTERVAL_MS = 1000

/**
 * Encapsulates the full voice-input lifecycle shared by NewSessionInput and
 * InputBar: STT engine, recording timer, phase-driven keyboard shortcuts,
 * editable transcript buffer, and cancel/confirm actions.
 *
 * The caller only provides `onSubmit` — what to do with the final text.
 * `onSubmit` may return `false` to signal failure (transcript is kept);
 * any other return (including `void`) is treated as success.
 */
export function useVoiceInput(
  onSubmit: (text: string) => void | boolean | Promise<void | boolean>,
) {
  const stt = useSpeechToText()
  const [editText, setEditText] = useState("")
  const [elapsed, setElapsed] = useState(0)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)

  // ── Recording elapsed timer ──────────────────────────────────────────
  useEffect(() => {
    if (stt.phase === "recording") {
      startTimeRef.current = Date.now()
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed(
          Math.floor((Date.now() - startTimeRef.current) / 1000),
        )
      }, TICK_INTERVAL_MS)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [stt.phase])

  // ── Seed editable buffer when phase transitions to "done" ────────────
  useEffect(() => {
    if (stt.phase === "done") {
      setEditText(stt.transcript)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })
    }
  }, [stt.phase, stt.transcript])

  // ── Auto-resize voice-edit textarea ──────────────────────────────────
  useLayoutEffect(() => {
    if (stt.phase !== "done") return
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, VOICE_TEXTAREA_MAX_HEIGHT_PX)}px`
  }, [stt.phase, editText])

  // ── Cancel / Confirm ─────────────────────────────────────────────────
  const cancel = useCallback(() => {
    void stt.stop()
    stt.resetTranscript()
    setEditText("")
  }, [stt])

  const confirm = useCallback(async () => {
    const text = editText.trim()
    if (!text) { cancel(); return }
    const result = await onSubmit(text)
    if (result === false) return
    stt.resetTranscript()
    setEditText("")
  }, [editText, onSubmit, cancel, stt])

  // ── Global keyboard shortcuts (Escape / Cmd+Enter) ───────────────────
  useEffect(() => {
    if (stt.phase === "idle") return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && stt.phase !== "recognizing") {
        e.preventDefault()
        cancel()
        return
      }
      if (
        stt.phase === "done" &&
        e.key === "Enter" &&
        (e.metaKey || e.ctrlKey)
      ) {
        if ((e as unknown as { isComposing?: boolean }).isComposing) return
        e.preventDefault()
        void confirm()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [stt.phase, cancel, confirm])

  // ── Textarea-local Cmd+Enter handler ─────────────────────────────────
  const handleTextareaKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void confirm()
      }
    },
    [confirm],
  )

  return {
    // STT passthrough
    stt,
    // Voice-input state
    editText,
    setEditText,
    elapsed,
    textareaRef,
    // Actions
    cancel,
    confirm,
    handleTextareaKeyDown,
  }
}

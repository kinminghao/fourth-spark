import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react"
import { ArrowUp, ImagePlus, X } from "lucide-react"
import clsx from "clsx"
import { useSessionStore, EMPTY_MESSAGES } from "../stores/session-store"
import { useRepoStore } from "../stores/repo-store"
import { useDraftStore } from "../stores/draft-store"
import { classifyPart, isQuestionPending } from "../lib/message-parts"
import type { ModelInfo, PromptFile } from "../lib/api-client"
import { getSettings, listModels } from "../lib/api-client"

const MAX_HEIGHT_PX = 200

// 5MB, well under OpenCode's 20MB decode cap — base64 in Postgres grows ~1.4x
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function useHasPendingQuestion(): boolean {
  return useSessionStore((state) => {
    const id = state.activeSessionId
    if (!id) return false
    const msgs = state.messages[id] ?? EMPTY_MESSAGES
    for (let i = msgs.length - 1; i >= 0; i--) {
      const parts = msgs[i].parts
      if (!parts) continue
      for (const part of parts) {
        if (classifyPart(part) === "tool" && isQuestionPending(part)) return true
      }
    }
    return false
  })
}

export function InputBar() {
  const [value, setValue] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [pinnedModels, setPinnedModels] = useState<ModelInfo[]>([])
  const [attachments, setAttachments] = useState<PromptFile[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const activeRepoId = useRepoStore((state) => state.activeRepoId)
  const status = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? state.sessionStatuses[id] : undefined
  })
  const sendMessage = useSessionStore((state) => state.sendMessage)
  const setDraft = useDraftStore((s) => s.setDraft)
  const clearDraft = useDraftStore((s) => s.clearDraft)
  const hasPendingQuestion = useHasPendingQuestion()

  useEffect(() => {
    if (!activeRepoId) { setPinnedModels([]); return }
    let cancelled = false
    void (async () => {
      try {
        const [settings, models] = await Promise.all([
          getSettings(),
          listModels(activeRepoId),
        ])
        if (cancelled) return
        const raw = settings.pinned_models
        const pinnedIds: string[] = raw ? JSON.parse(raw) : []
        setPinnedModels(pinnedIds.length > 0 ? models.filter((m) => pinnedIds.includes(m.id)) : [])
      } catch {
        if (!cancelled) setPinnedModels([])
      }
    })()
    return () => { cancelled = true }
  }, [activeRepoId])

  const busy = status === "busy" && !hasPendingQuestion
  const disabled = !activeSessionId

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) {
      return
    }
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

  useEffect(() => {
    setValue(activeSessionId ? useDraftStore.getState().drafts[activeSessionId] ?? "" : "")
    setAttachments([])
    setAttachError(null)
  }, [activeSessionId])

  // Unknown model (default / unpinned) stays permissive; only a hard false blocks
  const imagesAllowed = pinnedModels.find((m) => m.id === selectedModel)?.supportsImage !== false

  useEffect(() => {
    setAttachError(null)
    if (!imagesAllowed) {
      setAttachments([])
    }
  }, [imagesAllowed])

  const addFiles = async (incoming: File[]) => {
    const accepted: PromptFile[] = []
    const errors: string[] = []
    for (const file of incoming) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        errors.push(`${file.name || "文件"}：格式不支持`)
        continue
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        errors.push(`${file.name}：超过 5MB`)
        continue
      }
      accepted.push({ mime: file.type, url: await readAsDataUrl(file), filename: file.name })
    }
    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted])
    }
    setAttachError(errors.length > 0 ? errors.join("；") : null)
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    if (!imagesAllowed) {
      setAttachError("当前模型不支持图片")
      return
    }
    void addFiles(files)
  }

  const submit = async () => {
    const text = value.trim()
    if (!text || disabled) {
      return
    }
    const ok = await sendMessage(text, selectedModel || undefined, attachments.length > 0 ? attachments : undefined)
    if (ok) {
      setValue("")
      setAttachments([])
      setAttachError(null)
      if (activeSessionId) clearDraft(activeSessionId)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const placeholder = !activeSessionId
    ? "select or start a run"
    : hasPendingQuestion
      ? "输入回复，或点击上方选项…"
      : busy
        ? "输入消息将排队等待处理…"
        : "enter a command…"

  const promptColor = !activeSessionId
    ? "text-fg-6"
    : busy
      ? "text-amber-400 fs-blink"
      : hasPendingQuestion
        ? "text-blue-400"
        : "text-emerald-400"

  return (
    <div className="border-t border-line bg-term px-4 py-4">
      {attachments.length > 0 && (
        <div className="mx-auto mb-2 flex max-w-4xl flex-wrap gap-2">
          {attachments.map((file, index) => (
            <div key={`${file.filename ?? "img"}-${index}`} className="group relative">
              <img
                src={file.url}
                alt={file.filename ?? "attachment"}
                className="h-16 w-16 rounded border border-line object-cover"
              />
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                aria-label="Remove attachment"
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-term text-fg-4 opacity-0 transition-opacity duration-150 hover:text-fg-2 group-hover:opacity-100"
              >
                <X className="h-2.5 w-2.5" strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
      )}
      {attachError && (
        <div className="mx-auto mb-2 max-w-4xl font-mono text-[11px] text-red-400">{attachError}</div>
      )}
      <div
        className={clsx(
          "mx-auto flex max-w-4xl items-start gap-2 rounded-lg border px-3 py-2 transition-colors duration-150",
          disabled
            ? "border-line"
            : "border-fg-5 focus-within:border-fg-4",
        )}
      >
        <span className={clsx("select-none pt-px font-mono text-sm leading-6", promptColor)}>
          ❯
        </span>
        <textarea
          ref={textareaRef}
          rows={2}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const v = event.target.value
            setValue(v)
            if (activeSessionId) setDraft(activeSessionId, v)
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          className="flex-1 resize-none bg-transparent font-mono text-sm leading-6 text-fg placeholder:text-fg-6 focus:outline-none disabled:cursor-not-allowed"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          multiple
          hidden
          onChange={(event) => {
            void addFiles(Array.from(event.target.files ?? []))
            event.target.value = ""
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || !imagesAllowed}
          aria-label="Attach image"
          title={imagesAllowed ? "附加图片" : "当前模型不支持图片"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-5 transition-colors duration-150 hover:text-fg-3 disabled:cursor-not-allowed disabled:text-fg-6/40"
        >
          <ImagePlus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={disabled || value.trim().length === 0}
          aria-label="Send message"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white transition-colors duration-150 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6/30 disabled:text-fg-5"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
      <div className="mx-auto mt-1.5 flex max-w-4xl items-center gap-3 pl-5">
        <span className="font-mono text-[10px] text-fg-6">⏎ to run · shift+⏎ for newline</span>
        {pinnedModels.length > 0 && (
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="ml-auto max-w-[200px] truncate rounded border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-fg-4 focus:border-fg-5 focus:outline-none"
          >
            <option value="">默认模型</option>
            {pinnedModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name || m.id}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

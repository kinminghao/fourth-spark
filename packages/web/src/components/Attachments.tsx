import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react"
import clsx from "clsx"
import { FileText, ImagePlus, X } from "lucide-react"
import type { PromptFile } from "../lib/api-client"

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_ATTACHMENTS = 10
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

const TEXT_FOLD_LINE_THRESHOLD = 5
const TEXT_FOLD_CHAR_THRESHOLD = 500

let attachmentSeq = 0

interface AttachmentFile extends PromptFile {
  _id: string
}

export interface FoldedText {
  _id: string
  text: string
  lineCount: number
  byteSize: number
  placeholder: string
}

export function shouldFoldText(text: string): boolean {
  const lineCount = text.split("\n").length
  return lineCount > TEXT_FOLD_LINE_THRESHOLD || text.length > TEXT_FOLD_CHAR_THRESHOLD
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function ImageLightbox({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  useEffect(() => {
    // Capture phase + preventDefault so RunView's Escape-to-abort skips this keypress
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      onClose()
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
      className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-8 backdrop-blur-sm"
    >
      <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
    </div>
  )
}

export function PreviewableImage({ url, label, className }: { url: string; label: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`预览 ${label}`}
        className="block cursor-zoom-in rounded-md transition-opacity duration-150 hover:opacity-80"
      >
        <img src={url} alt={label} className={clsx("rounded-md border border-line", className)} />
      </button>
      {open && <ImageLightbox url={url} label={label} onClose={() => setOpen(false)} />}
    </>
  )
}

export function useAttachments(imagesAllowed = true) {
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [foldedTexts, setFoldedTexts] = useState<FoldedText[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    if (!imagesAllowed) {
      setAttachments([])
    }
  }, [imagesAllowed])

  const addFiles = async (incoming: File[]) => {
    const accepted: AttachmentFile[] = []
    const errors: string[] = []

    const currentCount = attachments.length
    let remaining = MAX_ATTACHMENTS - currentCount

    for (const file of incoming) {
      if (remaining <= 0) {
        errors.push(`最多 ${MAX_ATTACHMENTS} 张图片`)
        break
      }
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        errors.push(`${file.name || "文件"}：格式不支持`)
        continue
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        errors.push(`${file.name}：超过 5MB`)
        continue
      }
      accepted.push({ _id: `att-${++attachmentSeq}`, mime: file.type, url: await readAsDataUrl(file), filename: file.name })
      remaining--
    }
    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted])
    }
    setError(errors.length > 0 ? errors.join("；") : null)
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    if (!imagesAllowed) {
      setError("当前模型不支持图片")
      return
    }
    void addFiles(files)
  }

  const addFoldedText = (text: string): FoldedText => {
    const seq = ++attachmentSeq
    const lineCount = text.split("\n").length
    const byteSize = new TextEncoder().encode(text).byteLength
    const placeholder = `[粘贴文本 #${seq} · ${lineCount}行]`
    const entry: FoldedText = { _id: `fold-${seq}`, text, lineCount, byteSize, placeholder }
    setFoldedTexts((prev) => [...prev, entry])
    return entry
  }

  const expandFoldedTexts = (content: string): string => {
    let result = content
    for (const fold of foldedTexts) {
      result = result.replace(fold.placeholder, fold.text)
    }
    return result
  }

  const remove = (id: string) => setAttachments((prev) => prev.filter((a) => a._id !== id))
  const removeFoldedText = (id: string) => setFoldedTexts((prev) => prev.filter((f) => f._id !== id))

  const clear = useCallback(() => {
    setAttachments([])
    setFoldedTexts([])
    setError(null)
  }, [])

  const promptFiles: PromptFile[] = attachments.map(({ mime, url, filename }) => ({ mime, url, filename }))

  return { attachments, foldedTexts, promptFiles, error, setError, addFiles, onPaste, addFoldedText, expandFoldedTexts, remove, removeFoldedText, clear }
}

function TextPreviewLightbox({ text, label, onClose }: { text: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      onClose()
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [onClose])

  const lines = text.split("\n")
  const gutterWidth = String(lines.length).length

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm md:p-8"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-line bg-term"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="font-mono text-xs text-fg-3">{label}</span>
          <button type="button" onClick={onClose} className="text-fg-5 hover:text-fg-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <pre className="overflow-auto p-4 font-mono text-xs leading-relaxed text-fg-2">
          {lines.map((line, i) => (
            <div key={i}>
              <span
                className="mr-3 inline-block select-none text-right text-fg-6"
                style={{ width: `${gutterWidth}ch` }}
              >
                {i + 1}
              </span>
              {line}
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}

function TextChip({ fold, index, onRemove }: { fold: FoldedText; index: number; onRemove: () => void }) {
  const [preview, setPreview] = useState(false)
  const label = `粘贴文本 #${index} · ${fold.lineCount}行 · ${formatByteSize(fold.byteSize)}`

  return (
    <>
      <div className="group relative flex items-center gap-1.5 rounded-md border border-line bg-elevated/50 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setPreview(true)}
          className="flex items-center gap-1.5 font-mono text-xs text-fg-3 transition-colors hover:text-fg"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-fg-5" />
          <span>{label}</span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="移除粘贴文本"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-fg-5 transition-colors hover:text-fg-2"
        >
          <X className="h-2.5 w-2.5" strokeWidth={2.5} />
        </button>
      </div>
      {preview && <TextPreviewLightbox text={fold.text} label={label} onClose={() => setPreview(false)} />}
    </>
  )
}

export function AttachButton({
  onFiles,
  disabled,
  allowed,
}: {
  onFiles: (files: File[]) => void
  disabled?: boolean
  allowed: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        multiple
        hidden
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []))
          event.target.value = ""
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || !allowed}
        aria-label="Attach image"
        title={allowed ? "附加图片" : "当前模型不支持图片"}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-5 transition-colors duration-150 hover:text-fg-3 disabled:cursor-not-allowed disabled:text-fg-6/40"
      >
        <ImagePlus className="h-4 w-4" />
      </button>
    </>
  )
}

export function AttachmentStrip({
  attachments,
  foldedTexts,
  error,
  onRemove,
  onRemoveFoldedText,
  className,
}: {
  attachments: AttachmentFile[]
  foldedTexts?: FoldedText[]
  error: string | null
  onRemove: (id: string) => void
  onRemoveFoldedText?: (id: string) => void
  className?: string
}) {
  const hasContent = attachments.length > 0 || (foldedTexts ?? []).length > 0
  if (!hasContent && !error) {
    return null
  }
  return (
    <div className={className}>
      {hasContent && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((file) => (
            <div key={file._id} className="group relative">
              <PreviewableImage
                url={file.url}
                label={file.filename ?? "attachment"}
                className="h-16 w-16 object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(file._id)}
                aria-label="Remove attachment"
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-term text-fg-4 opacity-0 transition-opacity duration-150 hover:text-fg-2 group-hover:opacity-100"
              >
                <X className="h-2.5 w-2.5" strokeWidth={2.5} />
              </button>
            </div>
          ))}
          {(foldedTexts ?? []).map((fold, i) => (
            <TextChip
              key={fold._id}
              fold={fold}
              index={i + 1}
              onRemove={() => onRemoveFoldedText?.(fold._id)}
            />
          ))}
        </div>
      )}
      {error && <div className="mb-2 font-mono text-[11px] text-red-400">{error}</div>}
    </div>
  )
}

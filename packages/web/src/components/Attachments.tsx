import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react"
import clsx from "clsx"
import { ImagePlus, X } from "lucide-react"
import type { PromptFile } from "../lib/api-client"

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

export function ImageLightbox({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
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
  const [attachments, setAttachments] = useState<PromptFile[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
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

  const remove = (index: number) => setAttachments((prev) => prev.filter((_, i) => i !== index))

  const clear = useCallback(() => {
    setAttachments([])
    setError(null)
  }, [])

  return { attachments, error, setError, addFiles, onPaste, remove, clear }
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
  error,
  onRemove,
  className,
}: {
  attachments: PromptFile[]
  error: string | null
  onRemove: (index: number) => void
  className?: string
}) {
  if (attachments.length === 0 && !error) {
    return null
  }
  return (
    <div className={className}>
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((file, index) => (
            <div key={`${file.filename ?? "img"}-${index}`} className="group relative">
              <PreviewableImage
                url={file.url}
                label={file.filename ?? "attachment"}
                className="h-16 w-16 object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label="Remove attachment"
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-term text-fg-4 opacity-0 transition-opacity duration-150 hover:text-fg-2 group-hover:opacity-100"
              >
                <X className="h-2.5 w-2.5" strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <div className="mb-2 font-mono text-[11px] text-red-400">{error}</div>}
    </div>
  )
}

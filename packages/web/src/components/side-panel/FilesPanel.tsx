import { useState, useRef, useEffect, useCallback } from "react"
import clsx from "clsx"
import { FileText, Image, GripHorizontal, ChevronUp, ChevronDown } from "lucide-react"
import type { SessionFile } from "../../lib/api-client"
import { getSessionFiles, getSessionFileUrl } from "../../lib/api-client"
import { PreviewableImage } from "../Attachments"

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"])
const OPENABLE_EXTS = new Set([".html", ".htm", ".md", ".txt", ".log"])
const FILES_PANEL_MIN_HEIGHT = 80
const FILES_PANEL_DEFAULT_HEIGHT = 160
const FILES_PANEL_MAX_RATIO = 0.4

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return idx >= 0 ? path.slice(idx + 1) : path
}

export interface PreviewFileInfo {
  url: string
  name: string
  ext: string
}

function FileItem({
  file,
  repoId,
  sessionId,
  onPreviewFile,
}: {
  file: SessionFile
  repoId: string
  sessionId: string
  onPreviewFile?: (info: PreviewFileInfo) => void
}) {
  const name = basename(file.path)
  const url = getSessionFileUrl(repoId, sessionId, file.path)
  const ext = file.ext.toLowerCase()

  if (IMAGE_EXTS.has(ext)) {
    return (
      <li
        className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-elevated/60"
        title={file.path}
      >
        <Image className="h-3 w-3 shrink-0 text-fg-5" aria-hidden />
        <PreviewableImage
          url={url}
          label={name}
          className="h-8 w-8 shrink-0 object-cover"
        />
        <span className="min-w-0 truncate text-xs text-fg-3">{name}</span>
      </li>
    )
  }

  if (OPENABLE_EXTS.has(ext)) {
    return (
      <li>
        <button
          type="button"
          title={file.path}
          onClick={() => onPreviewFile?.({ url, name, ext })}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-elevated/60"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-fg-4" />
          <span className="min-w-0 truncate text-xs text-fg-3">{name}</span>
        </button>
      </li>
    )
  }

  return (
    <li
      className="flex items-center gap-2 rounded-md px-2 py-1"
      title={file.path}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-fg-4" />
      <span className="min-w-0 truncate text-xs text-fg-3">{name}</span>
    </li>
  )
}

export function FilesPanel({
  repoId,
  sessionId,
  containerRef,
  onPreviewFile,
}: {
  repoId: string
  sessionId: string
  containerRef: React.RefObject<HTMLDivElement | null>
  onPreviewFile?: (info: PreviewFileInfo) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [panelHeight, setPanelHeight] = useState(FILES_PANEL_DEFAULT_HEIGHT)
  const [files, setFiles] = useState<readonly SessionFile[]>([])
  const [containerHeight, setContainerHeight] = useState(0)

  const panelRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<{ startY: number; startHeight: number; maxHeight: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetch = () => {
      getSessionFiles(repoId, sessionId)
        .then((res) => { if (!cancelled) setFiles(res) })
        .catch(() => { if (!cancelled) setFiles([]) })
    }
    fetch()
    const interval = setInterval(fetch, 10_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [repoId, sessionId])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setContainerHeight(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  const rawMax = containerHeight > 0 ? containerHeight * FILES_PANEL_MAX_RATIO : panelHeight
  const maxHeight = Math.max(FILES_PANEL_MIN_HEIGHT, rawMax)
  const effectiveHeight = Math.min(panelHeight, maxHeight)

  const handleDragStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      const container = containerRef.current
      const currentMax = Math.max(
        FILES_PANEL_MIN_HEIGHT,
        container ? container.clientHeight * FILES_PANEL_MAX_RATIO : maxHeight,
      )
      dragStateRef.current = {
        startY: e.clientY,
        startHeight: effectiveHeight,
        maxHeight: currentMax,
      }

      const onMove = (ev: MouseEvent) => {
        const state = dragStateRef.current
        if (!state) return
        const delta = state.startY - ev.clientY
        const next = Math.max(
          FILES_PANEL_MIN_HEIGHT,
          Math.min(state.startHeight + delta, state.maxHeight),
        )
        if (panelRef.current) panelRef.current.style.height = `${next}px`
      }

      const onUp = () => {
        const el = panelRef.current
        if (el) {
          const parsed = parseInt(el.style.height, 10)
          if (!Number.isNaN(parsed)) setPanelHeight(parsed)
        }
        dragStateRef.current = null
        window.removeEventListener("mousemove", onMove)
        window.removeEventListener("mouseup", onUp)
      }

      window.addEventListener("mousemove", onMove)
      window.addEventListener("mouseup", onUp)
    },
    [containerRef, effectiveHeight, maxHeight],
  )

  const count = files.length

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full shrink-0 items-center gap-1.5 border-t border-line px-3 py-2 text-left transition-colors hover:bg-elevated/60"
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-fg-4" />
        <span className="text-xs font-medium text-fg-3">变更文件</span>
        <span className="font-mono text-[10px] text-fg-5">{count}</span>
        <ChevronUp className="ml-auto h-3.5 w-3.5 text-fg-5" />
      </button>
    )
  }

  return (
    <div
      ref={panelRef}
      className="flex shrink-0 flex-col border-t border-line bg-surface"
      style={{ height: `${effectiveHeight}px` }}
    >
      <div
        onMouseDown={handleDragStart}
        role="separator"
        aria-orientation="horizontal"
        className="flex h-1 shrink-0 cursor-row-resize items-center justify-center bg-line transition-colors hover:bg-blue-500/60"
      >
        <GripHorizontal className="h-2 w-8 text-fg-6" aria-hidden />
      </div>
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="flex shrink-0 items-center gap-1.5 border-b border-line px-3 py-2 text-left transition-colors hover:bg-elevated/60"
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-fg-4" />
        <span className="text-xs font-medium text-fg-3">变更文件</span>
        <span className="font-mono text-[10px] text-fg-5">{count}</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 text-fg-5" />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {count === 0 ? (
          <p className="px-2 py-4 text-center font-mono text-xs text-fg-5">
            暂无变更文件
          </p>
        ) : (
          <ul className="space-y-0.5">
            {files.map((f) => (
              <FileItem key={f.path} file={f} repoId={repoId} sessionId={sessionId} onPreviewFile={onPreviewFile} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

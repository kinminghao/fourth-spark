import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import clsx from "clsx"
import type { PreviewFileInfo } from "../../components/SidePanel"

export const HTML_PREVIEW_EXTS = new Set([".html", ".htm"])
export const MD_PREVIEW_EXT = ".md"

export function FilePreviewContent({ file }: { file: PreviewFileInfo }) {
  const [textContent, setTextContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (HTML_PREVIEW_EXTS.has(file.ext)) return
    setLoading(true)
    setTextContent(null)
    fetch(file.url)
      .then((r) => r.text())
      .then((t) => setTextContent(t))
      .catch(() => setTextContent("加载失败"))
      .finally(() => setLoading(false))
  }, [file.url, file.ext])

  if (HTML_PREVIEW_EXTS.has(file.ext)) {
    return <iframe src={file.url} sandbox="" title={file.name} className="h-full w-full border-0 bg-white" />
  }
  if (loading) {
    return <p className="p-8 text-center font-mono text-sm text-fg-5">加载中…</p>
  }
  if (file.ext === MD_PREVIEW_EXT) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="prose prose-invert max-w-none p-6">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{textContent ?? ""}</ReactMarkdown>
        </div>
      </div>
    )
  }
  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap p-6 font-mono text-xs leading-relaxed text-fg-2">
      {textContent}
    </pre>
  )
}

export function usePreviewTabs(activeSessionId: string | null) {
  const [tabs, setTabs] = useState<PreviewFileInfo[]>([])
  const [activeIdx, setActiveIdx] = useState<number | null>(null)

  useEffect(() => { setTabs([]); setActiveIdx(null) }, [activeSessionId])

  const open = (info: PreviewFileInfo) => {
    setTabs((prev) => {
      const existing = prev.findIndex((t) => t.url === info.url)
      if (existing >= 0) {
        setActiveIdx(existing)
        return prev
      }
      setActiveIdx(prev.length)
      return [...prev, info]
    })
  }

  const close = (idx: number) => {
    setTabs((prev) => {
      const next = prev.filter((_, i) => i !== idx)
      setActiveIdx((cur) => {
        if (cur === idx) return null
        if (cur !== null && cur > idx) return cur - 1
        return cur
      })
      return next
    })
  }

  const activate = (idx: number | null) => setActiveIdx(idx)

  return { tabs, activeIdx, open, close, activate }
}

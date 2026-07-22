import { useState } from "react"
import { X } from "lucide-react"
import { useRepoStore } from "../stores/repo-store"
import { resolveRepo } from "../lib/api-client"

export function AddRepoModal({ onClose }: { onClose: () => void }) {
  const [localPath, setLocalPath] = useState("")
  const [name, setName] = useState("")
  const [gitUrl, setGitUrl] = useState("")
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState("")
  const addRepo = useRepoStore((s) => s.addRepo)

  const canSubmit = name.trim() !== "" && gitUrl.trim() !== "" && localPath.trim() !== "" && !resolving

  const handleResolvePath = async (path: string) => {
    const trimmed = path.trim()
    if (!trimmed) return
    setResolving(true)
    setError("")
    try {
      const result = await resolveRepo(trimmed)
      if (result.name && !name.trim()) setName(result.name)
      if (result.gitUrl && !gitUrl.trim()) setGitUrl(result.gitUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "无法解析路径"
      try {
        const parsed = JSON.parse(msg)
        setError(parsed.error ?? msg)
      } catch {
        setError(msg)
      }
    }
    setResolving(false)
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setError("")
    const repo = await addRepo(name.trim(), gitUrl.trim(), localPath.trim())
    if (repo) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">添加仓库</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-fg-4 hover:bg-elevated hover:text-fg-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="m-path" className="text-xs font-medium text-fg-3">本地路径</label>
            <input
              id="m-path"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              onBlur={(e) => void handleResolvePath(e.target.value)}
              placeholder="/Users/you/code/repo"
              autoFocus
              className="w-full rounded-lg border border-line bg-base px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <span className="text-[11px] text-fg-5">
              {resolving ? "正在读取 Git 信息…" : "输入路径后自动读取仓库信息"}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="m-name" className="text-xs font-medium text-fg-3">名称</label>
            <input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
              className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-fg placeholder:text-fg-5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="m-git" className="text-xs font-medium text-fg-3">Git 远程地址</label>
            <input
              id="m-git"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="https://github.com/org/repo.git"
              className="w-full rounded-lg border border-line bg-base px-3 py-2 font-mono text-xs text-fg placeholder:text-fg-5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {error && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</p>
          )}

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-4 py-2 text-sm text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-fg-6 disabled:text-fg-4"
            >
              添加仓库
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

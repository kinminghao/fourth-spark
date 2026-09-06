import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangle, X, FolderSearch, GitBranch, Loader2, ChevronDown } from "lucide-react"
import { useRepoStore } from "../stores/repo-store"
import { resolveRepo, cloneRepo, listGitHosts } from "../lib/api-client"
import { extractHostFromGitUrl } from "../lib/git-url"
import { DirectoryBrowser } from "./DirectoryBrowser"

type Mode = "browse" | "clone"

export function AddRepoModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>("browse")
  const [localPath, setLocalPath] = useState("")
  const [name, setName] = useState("")
  const [gitUrl, setGitUrl] = useState("")
  const [cloneTargetDir, setCloneTargetDir] = useState("")
  const [showCloneDirPicker, setShowCloneDirPicker] = useState(false)
  const [runtimeType, setRuntimeType] = useState("opencode")
  const [resolving, setResolving] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState("")
  const [hostWarning, setHostWarning] = useState<string | null>(null)
  const addRepo = useRepoStore((s) => s.addRepo)

  const canSubmit = name.trim() !== "" && gitUrl.trim() !== "" && localPath.trim() !== "" && !resolving && !cloning

  const parseApiError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : "操作失败"
    try {
      const parsed = JSON.parse(msg)
      return parsed.error ?? msg
    } catch {
      return msg
    }
  }

  const handleResolvePath = async (path: string) => {
    const trimmed = path.trim()
    if (!trimmed) return
    setResolving(true)
    setError("")
    try {
      const result = await resolveRepo(trimmed)
      setLocalPath(result.localPath)
      if (result.name) setName(result.name)
      if (result.gitUrl) setGitUrl(result.gitUrl)
    } catch (err) {
      setError(parseApiError(err))
    }
    setResolving(false)
  }

  const resolveRef = useRef(handleResolvePath)
  resolveRef.current = handleResolvePath

  useEffect(() => {
    if (mode !== "browse") return
    const trimmed = localPath.trim()
    if (!trimmed) return
    const timer = setTimeout(() => {
      void resolveRef.current(trimmed)
    }, 500)
    return () => clearTimeout(timer)
  }, [localPath, mode])

  useEffect(() => {
    const trimmed = gitUrl.trim()
    if (!trimmed) { setHostWarning(null); return }
    const host = extractHostFromGitUrl(trimmed)
    if (!host) { setHostWarning(null); return }

    let cancelled = false
    const timer = setTimeout(() => {
      listGitHosts()
        .then((hosts) => {
          if (cancelled) return
          const found = hosts.some((h) => h.host.toLowerCase() === host.toLowerCase())
          setHostWarning(found ? null : host)
        })
        .catch(() => { if (!cancelled) setHostWarning(null) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [gitUrl])

  const handleBrowseSelect = (path: string) => {
    setLocalPath(path)
    setError("")
    void handleResolvePath(path)
  }

  const handleCloneTargetSelect = (path: string) => {
    setCloneTargetDir(path)
    setShowCloneDirPicker(false)
  }

  const handleClone = async () => {
    const trimmedUrl = gitUrl.trim()
    if (!trimmedUrl) {
      setError("请输入 Git 仓库地址")
      return
    }
    setCloning(true)
    setError("")
    try {
      const target = cloneTargetDir.trim() || undefined
      const result = await cloneRepo(trimmedUrl, target)
      setLocalPath(result.localPath)
      if (result.name) setName(result.name)
      if (result.gitUrl) setGitUrl(result.gitUrl)
    } catch (err) {
      setError(parseApiError(err))
    }
    setCloning(false)
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setError("")
    const repo = await addRepo(name.trim(), gitUrl.trim(), localPath.trim(), runtimeType)
    if (repo) onClose()
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    setLocalPath("")
    setName("")
    setGitUrl("")
    setCloneTargetDir("")
    setShowCloneDirPicker(false)
    setError("")
    setHostWarning(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-line bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">添加仓库</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-fg-4 hover:bg-elevated hover:text-fg-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 flex gap-1 rounded-lg border border-line bg-base p-1">
          <button
            type="button"
            onClick={() => switchMode("browse")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "browse"
                ? "bg-elevated text-fg shadow-sm"
                : "text-fg-4 hover:text-fg-2"
            }`}
          >
            <FolderSearch className="h-3.5 w-3.5" />
            已有仓库
          </button>
          <button
            type="button"
            onClick={() => switchMode("clone")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "clone"
                ? "bg-elevated text-fg shadow-sm"
                : "text-fg-4 hover:text-fg-2"
            }`}
          >
            <GitBranch className="h-3.5 w-3.5" />
            克隆新仓库
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {mode === "browse" ? (
            <>
              <DirectoryBrowser onSelect={handleBrowseSelect} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="m-path" className="text-xs font-medium text-fg-3">本地路径</label>
                <input
                  id="m-path"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  onBlur={(e) => void handleResolvePath(e.target.value)}
                  placeholder="/home/you/code/repo"
                  className="w-full rounded-lg border border-line bg-base px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <span className="text-[11px] text-fg-5">
                  {resolving ? "正在读取 Git 信息…" : "点选目录或手动输入路径"}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="m-clone-url" className="text-xs font-medium text-fg-3">Git 仓库地址</label>
                <input
                  id="m-clone-url"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  placeholder="https://github.com/org/repo.git"
                  autoFocus
                  className="w-full rounded-lg border border-line bg-base px-3 py-2 font-mono text-xs text-fg placeholder:text-fg-5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-fg-3">目标目录</label>
                <div className="flex items-center gap-2">
                  <input
                    value={cloneTargetDir}
                    onChange={(e) => setCloneTargetDir(e.target.value)}
                    placeholder="默认: ~/.fourth-spark/repos/"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-base px-3 py-2 font-mono text-xs text-fg placeholder:text-fg-5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCloneDirPicker((v) => !v)}
                    className={`shrink-0 rounded-lg border px-2.5 py-2 text-sm transition-colors ${
                      showCloneDirPicker
                        ? "border-blue-500 bg-blue-500/10 text-blue-600"
                        : "border-line bg-base text-fg-4 hover:bg-elevated hover:text-fg-2"
                    }`}
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showCloneDirPicker ? "rotate-180" : ""}`} />
                  </button>
                </div>
                {showCloneDirPicker && (
                  <DirectoryBrowser onSelect={handleCloneTargetSelect} />
                )}
                <span className="text-[11px] text-fg-5">
                  留空则克隆到默认目录，选择目录后仓库将克隆到该目录下
                </span>
              </div>

              <button
                type="button"
                onClick={handleClone}
                disabled={cloning || !gitUrl.trim()}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6 disabled:text-fg-4"
              >
                {cloning ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在克隆仓库…
                  </span>
                ) : (
                  "克隆"
                )}
              </button>

              {localPath && (
                <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600">
                  克隆完成: <span className="font-mono">{localPath}</span>
                </div>
              )}
            </>
          )}

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

          {mode === "browse" && (
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
          )}

          {hostWarning && (
            <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                源站 <strong>{hostWarning}</strong> 尚未配置访问凭证，Issue/PR 同步将不可用。
                <button
                  type="button"
                  onClick={() => { onClose(); navigate("/settings") }}
                  className="ml-1 font-medium underline hover:text-amber-700"
                >
                  去配置
                </button>
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-3">运行时</label>
            <div className="flex gap-2">
              {[
                { value: "opencode", label: "OpenCode" },
                { value: "claude-code", label: "Claude Code" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRuntimeType(opt.value)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    runtimeType === opt.value
                      ? "border-blue-500 bg-blue-500/10 text-blue-600"
                      : "border-line bg-base text-fg-4 hover:bg-elevated hover:text-fg-2"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-fg-5">
              {runtimeType === "claude-code" ? "需要本地安装 Claude Code CLI" : "需要本地安装 OpenCode CLI"}
            </span>
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

import { useState, useEffect, useCallback } from "react"
import { Folder, GitBranch, ChevronRight, Eye, EyeOff, Loader2 } from "lucide-react"
import { browseDir } from "../lib/api-client"
import type { DirEntry } from "../lib/api-client"

interface DirectoryBrowserProps {
  onSelect: (path: string) => void
}

export function DirectoryBrowser({ onSelect }: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>("")
  const [parent, setParent] = useState<string | null>(null)
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [showHidden, setShowHidden] = useState(false)

  const loadDir = useCallback(async (path?: string) => {
    setLoading(true)
    setError("")
    try {
      const result = await browseDir(path, showHidden)
      setCurrentPath(result.path)
      setParent(result.parent)
      setEntries(result.entries)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "无法读取目录"
      try {
        const parsed = JSON.parse(msg)
        setError(parsed.error ?? msg)
      } catch {
        setError(msg)
      }
    }
    setLoading(false)
  }, [showHidden])

  useEffect(() => {
    void loadDir()
  }, [loadDir])

  const navigateTo = (dirName: string) => {
    void loadDir(currentPath + "/" + dirName)
  }

  const navigateUp = () => {
    if (parent) void loadDir(parent)
  }

  const navigateToBreadcrumb = (index: number) => {
    const segments = currentPath.split("/").filter(Boolean)
    const target = "/" + segments.slice(0, index + 1).join("/")
    void loadDir(target)
  }

  const selectGitRepo = (dirName: string) => {
    onSelect(currentPath + "/" + dirName)
  }

  const pathSegments = currentPath.split("/").filter(Boolean)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs">
          <button
            type="button"
            onClick={() => void loadDir("/")}
            className="shrink-0 rounded px-1 py-0.5 text-fg-4 hover:bg-elevated hover:text-fg-2"
          >
            /
          </button>
          {pathSegments.map((seg, i) => (
            <span key={i} className="flex shrink-0 items-center gap-1">
              <ChevronRight className="h-3 w-3 text-fg-5" />
              <button
                type="button"
                onClick={() => navigateToBreadcrumb(i)}
                className={`rounded px-1 py-0.5 ${
                  i === pathSegments.length - 1
                    ? "font-medium text-fg"
                    : "text-fg-4 hover:bg-elevated hover:text-fg-2"
                }`}
              >
                {seg}
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowHidden((v) => !v)}
          className="ml-2 shrink-0 rounded-md p-1 text-fg-4 hover:bg-elevated hover:text-fg-2"
          title={showHidden ? "隐藏隐藏文件" : "显示隐藏文件"}
        >
          {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="max-h-52 overflow-y-auto rounded-lg border border-line bg-base">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-fg-4" />
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-center text-xs text-red-500">{error}</div>
        ) : (
          <>
            {parent !== null && (
              <button
                type="button"
                onClick={navigateUp}
                className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-sm text-fg-3 hover:bg-elevated"
              >
                <Folder className="h-3.5 w-3.5 text-fg-5" />
                <span>..</span>
              </button>
            )}
            {entries.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-fg-5">空目录</div>
            )}
            {entries.map((entry) => (
              <div
                key={entry.name}
                className="flex items-center border-b border-line last:border-0"
              >
                <button
                  type="button"
                  onClick={() => entry.isGitRepo ? selectGitRepo(entry.name) : navigateTo(entry.name)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-elevated"
                >
                  {entry.isGitRepo ? (
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-fg-4" />
                  )}
                  <span className={`truncate ${entry.isGitRepo ? "text-fg font-medium" : "text-fg-3"}`}>
                    {entry.name}
                  </span>
                  {entry.isGitRepo && (
                    <span className="ml-auto shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                      git
                    </span>
                  )}
                </button>
                {entry.isGitRepo && (
                  <button
                    type="button"
                    onClick={() => navigateTo(entry.name)}
                    className="shrink-0 px-2 py-2 text-fg-5 hover:text-fg-2"
                    title="进入目录"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

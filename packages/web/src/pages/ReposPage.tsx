import { useState } from "react"
import { Check, Circle, CircleDot, Play, Plus, Square, Trash2, X } from "lucide-react"
import clsx from "clsx"
import * as api from "../lib/api-client"
import { useRepoStore } from "../stores/repo-store"
import { AddRepoModal } from "../components/AddRepoModal"

export function ReposPage() {
  const repos = useRepoStore((s) => s.repos)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const setActiveRepo = useRepoStore((s) => s.setActiveRepo)
  const removeRepo = useRepoStore((s) => s.removeRepo)
  const loadRepos = useRepoStore((s) => s.loadRepos)
  const [showAdd, setShowAdd] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const handleToggle = async (repoId: string, running: boolean) => {
    setTogglingId(repoId)
    try {
      if (running) {
        await api.stopRepo(repoId)
      } else {
        await api.startRepo(repoId)
      }
      await loadRepos()
    } catch {}
    setTogglingId(null)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">仓库管理</h1>
            <p className="mt-0.5 text-sm text-fg-4">管理代码仓库，每个仓库对应一个独立的 Agent 运行环境</p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" />
            添加仓库
          </button>
        </div>

        {repos.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-hard py-16 text-center">
            <div className="rounded-full bg-elevated p-3">
              <Plus className="h-6 w-6 text-fg-4" />
            </div>
            <p className="text-sm font-medium text-fg-3">暂无代码仓库</p>
            <p className="text-xs text-fg-5">添加一个本地仓库开始使用</p>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="mt-2 rounded-lg border border-line px-4 py-2 text-sm text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
            >
              添加仓库
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-4">名称</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-4">Git 地址</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-4">本地路径</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-4">状态</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-fg-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {repos.map((repo) => {
                  const isActive = repo.id === activeRepoId
                  return (
                    <tr
                      key={repo.id}
                      className={clsx(
                        "group border-b border-line transition-colors last:border-b-0",
                        isActive ? "bg-blue-500/5" : "hover:bg-surface/60",
                      )}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setActiveRepo(repo.id)}
                          className="flex items-center gap-2 text-left"
                        >
                          {isActive ? (
                            <CircleDot className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                          ) : (
                            <Circle className="h-3.5 w-3.5 shrink-0 text-fg-5" />
                          )}
                          <span className={clsx("font-medium", isActive ? "text-fg" : "text-fg-2")}>
                            {repo.name}
                          </span>
                        </button>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-fg-4">
                        {repo.gitUrl}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-fg-4">
                        {repo.localPath}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={clsx(
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                            repo.running
                              ? "bg-emerald-500/10 text-emerald-600"
                              : "bg-fg-6/30 text-fg-4",
                          )}
                        >
                          <span className={clsx("h-1.5 w-1.5 rounded-full", repo.running ? "bg-emerald-500" : "bg-fg-5")} />
                          {repo.running ? "运行中" : "已停止"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleToggle(repo.id, repo.running)}
                            disabled={togglingId === repo.id}
                            title={repo.running ? "停止" : "启动"}
                            className={clsx(
                              "rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                              repo.running
                                ? "text-amber-600 hover:bg-amber-500/10"
                                : "text-emerald-600 hover:bg-emerald-500/10",
                            )}
                          >
                            {togglingId === repo.id ? (
                              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            ) : repo.running ? (
                              <span className="flex items-center gap-1"><Square className="h-3 w-3 fill-current" />停止</span>
                            ) : (
                              <span className="flex items-center gap-1"><Play className="h-3 w-3 fill-current" />启动</span>
                            )}
                          </button>
                          {confirmingId === repo.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => { void removeRepo(repo.id); setConfirmingId(null) }}
                                className="rounded-md p-1.5 text-red-500 transition-colors hover:bg-red-500/10"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingId(null)}
                                className="rounded-md p-1.5 text-fg-4 transition-colors hover:bg-elevated"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmingId(repo.id)}
                              className="rounded-md p-1.5 text-fg-5 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-fg-5">{repos.length} 个仓库</p>
      </div>

      {showAdd && <AddRepoModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

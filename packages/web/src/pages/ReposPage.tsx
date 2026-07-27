import { useState } from "react"
import { ArrowDownToLine, Check, Circle, CircleDot, Copy, FileText, Play, Plus, Square, Trash2, X } from "lucide-react"
import clsx from "clsx"
import * as api from "../lib/api-client"
import { useRepoStore } from "../stores/repo-store"
import { AddRepoModal } from "../components/AddRepoModal"
import { AgentsMdModal } from "../components/AgentsMdModal"

export function ReposPage() {
  const repos = useRepoStore((s) => s.repos)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const setActiveRepo = useRepoStore((s) => s.setActiveRepo)
  const removeRepo = useRepoStore((s) => s.removeRepo)
  const loadRepos = useRepoStore((s) => s.loadRepos)
  const [showAdd, setShowAdd] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [pullingId, setPullingId] = useState<string | null>(null)
  const [pullError, setPullError] = useState<string | null>(null)
  const [agentsMdRepo, setAgentsMdRepo] = useState<{ id: string; name: string } | null>(null)

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

  const handlePull = async (repoId: string) => {
    setPullingId(repoId)
    setPullError(null)
    try {
      await api.pullRepo(repoId)
      await loadRepos()
    } catch (err) {
      let message = "拉取失败"
      if (err instanceof api.ApiError) {
        try { message = JSON.parse(err.message).error ?? err.message } catch { message = err.message }
      }
      setPullError(message)
    }
    setPullingId(null)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-fg">仓库管理</h1>
            <p className="mt-0.5 text-sm text-fg-4">管理代码仓库，每个仓库对应一个独立的 Agent 运行环境</p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 md:px-4"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden md:inline">添加仓库</span>
          </button>
        </div>

        {pullError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-sm text-red-600">
            <span>{pullError}</span>
            <button type="button" onClick={() => setPullError(null)} className="shrink-0 rounded p-0.5 transition-colors hover:bg-red-500/10">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

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
          <>
          <div className="hidden overflow-hidden rounded-xl border border-line md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-4">名称</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-4">Git 地址</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-4">本地路径</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-4">状态</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-4">直连链接</th>
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
                      <td className="px-4 py-3">
                        {repo.running && repo.port ? (
                          <span className="inline-flex items-center gap-1.5">
                            <a
                              href={`http://127.0.0.1:${repo.port}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-blue-500 hover:underline"
                            >
                              127.0.0.1:{repo.port}
                            </a>
                            <button
                              type="button"
                              onClick={() => void navigator.clipboard.writeText(`http://127.0.0.1:${repo.port}`)}
                              title="复制链接"
                              className="rounded p-0.5 text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </span>
                        ) : (
                          <span className="text-xs text-fg-5">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setAgentsMdRepo({ id: repo.id, name: repo.name })}
                            title="配置 AGENTS.md"
                            className="rounded-md px-2 py-1 text-xs font-medium text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
                          >
                            <span className="flex items-center gap-1"><FileText className="h-3 w-3" />配置</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handlePull(repo.id)}
                            disabled={pullingId === repo.id}
                            title="拉取最新代码"
                            className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-500/10 disabled:opacity-50"
                          >
                            {pullingId === repo.id ? (
                              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            ) : (
                              <span className="flex items-center gap-1"><ArrowDownToLine className="h-3 w-3" />拉取</span>
                            )}
                          </button>
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

          {/* mobile card list */}
          <div className="flex flex-col gap-3 md:hidden">
            {repos.map((repo) => {
              const isActive = repo.id === activeRepoId
              return (
                <div
                  key={repo.id}
                  className={clsx(
                    "rounded-xl border p-4 transition-colors",
                    isActive ? "border-blue-500/40 bg-blue-500/5" : "border-line",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveRepo(repo.id)}
                      className="flex min-w-0 items-center gap-2 text-left"
                    >
                      {isActive ? (
                        <CircleDot className="h-4 w-4 shrink-0 text-blue-500" />
                      ) : (
                        <Circle className="h-4 w-4 shrink-0 text-fg-5" />
                      )}
                      <span className={clsx("truncate font-medium", isActive ? "text-fg" : "text-fg-2")}>
                        {repo.name}
                      </span>
                    </button>
                    <span
                      className={clsx(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                        repo.running
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-fg-6/30 text-fg-4",
                      )}
                    >
                      <span className={clsx("h-1.5 w-1.5 rounded-full", repo.running ? "bg-emerald-500" : "bg-fg-5")} />
                      {repo.running ? "运行中" : "已停止"}
                    </span>
                  </div>

                  <dl className="mt-3 space-y-1 font-mono text-xs text-fg-4">
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-fg-5">Git</dt>
                      <dd className="min-w-0 truncate">{repo.gitUrl}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-fg-5">路径</dt>
                      <dd className="min-w-0 truncate">{repo.localPath}</dd>
                    </div>
                    {repo.running && repo.port && (
                      <div className="flex items-center gap-2">
                        <dt className="shrink-0 text-fg-5">直连</dt>
                        <dd className="flex min-w-0 items-center gap-1.5">
                          <a
                            href={`http://127.0.0.1:${repo.port}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate text-blue-500 hover:underline"
                          >
                            127.0.0.1:{repo.port}
                          </a>
                          <button
                            type="button"
                            onClick={() => void navigator.clipboard.writeText(`http://127.0.0.1:${repo.port}`)}
                            title="复制链接"
                            className="shrink-0 rounded p-0.5 text-fg-5 transition-colors hover:text-fg-3"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </dd>
                      </div>
                    )}
                  </dl>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAgentsMdRepo({ id: repo.id, name: repo.name })}
                      className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-medium text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
                    >
                      <FileText className="h-3 w-3" />配置
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePull(repo.id)}
                      disabled={pullingId === repo.id}
                      className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-blue-500/30 px-2.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-500/10 disabled:opacity-50"
                    >
                      {pullingId === repo.id ? (
                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : (
                        <><ArrowDownToLine className="h-3 w-3" />拉取</>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggle(repo.id, repo.running)}
                      disabled={togglingId === repo.id}
                      className={clsx(
                        "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors disabled:opacity-50",
                        repo.running
                          ? "border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                          : "border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10",
                      )}
                    >
                      {togglingId === repo.id ? (
                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : repo.running ? (
                        <><Square className="h-3 w-3 fill-current" />停止</>
                      ) : (
                        <><Play className="h-3 w-3 fill-current" />启动</>
                      )}
                    </button>
                    {confirmingId === repo.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => { void removeRepo(repo.id); setConfirmingId(null) }}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-500/30 text-red-500 transition-colors hover:bg-red-500/10"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-fg-4 transition-colors hover:bg-elevated"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingId(repo.id)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-fg-5 transition-colors hover:bg-red-500/10 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          </>
        )}

        <p className="mt-3 text-xs text-fg-5">{repos.length} 个仓库</p>
      </div>

      {showAdd && <AddRepoModal onClose={() => setShowAdd(false)} />}
      {agentsMdRepo && (
        <AgentsMdModal
          repoId={agentsMdRepo.id}
          repoName={agentsMdRepo.name}
          onClose={() => setAgentsMdRepo(null)}
        />
      )}
    </div>
  )
}

import { useEffect, useState } from "react"
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleDot,
  Copy,
  FileText,
  GitBranch,
  HardDrive,
  Play,
  Plus,
  Square,
  Trash2,
  X,
} from "lucide-react"
import clsx from "clsx"
import * as api from "../lib/api-client"
import { useRepoStore } from "../stores/repo-store"
import { useToastStore } from "../stores/toast-store"
import { AddRepoModal } from "../components/AddRepoModal"
import { AgentsMdModal } from "../components/AgentsMdModal"

const BYTES_PER_KB = 1024
const BYTES_PER_MB = BYTES_PER_KB * 1024
const BYTES_PER_GB = BYTES_PER_MB * 1024

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B"
  if (bytes < BYTES_PER_KB) return `${bytes} B`
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`
  if (bytes < BYTES_PER_GB) return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`
  return `${(bytes / BYTES_PER_GB).toFixed(2)} GB`
}

const WS_BRANCH_PREFIX = "ws/"

function WorkspacesSection({ repoId }: { repoId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [workspaces, setWorkspaces] = useState<api.Workspace[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [cleaning, setCleaning] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await api.listWorkspaces(repoId)
      setWorkspaces(list)
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "加载失败")
    }
    setLoading(false)
  }

  useEffect(() => {
    if (expanded && workspaces === null) {
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  const handleRemove = async (id: string) => {
    setRemovingId(id)
    try {
      await api.removeWorkspace(repoId, id)
      await load()
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "删除失败")
    }
    setRemovingId(null)
  }

  const handleCleanup = async () => {
    setCleaning(true)
    try {
      await api.cleanupWorkspaces(repoId)
      await load()
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "清理失败")
    }
    setCleaning(false)
  }

  const count = workspaces?.length ?? 0
  const totalDisk = workspaces?.reduce((sum, ws) => sum + (ws.diskUsage || 0), 0) ?? 0

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-fg-3 transition-colors hover:text-fg-2"
        >
          {expanded ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
          <GitBranch className="h-3 w-3 shrink-0 text-fg-5" />
          <span>工作空间</span>
          {workspaces !== null && (
            <span className="text-fg-5">
              ({count}) · {formatBytes(totalDisk)}
            </span>
          )}
        </button>
        {expanded && count > 0 && (
          <button
            type="button"
            onClick={() => void handleCleanup()}
            disabled={cleaning}
            className="flex h-6 shrink-0 items-center gap-1 rounded border border-line px-2 text-xs text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2 disabled:opacity-50"
          >
            {cleaning ? (
              <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : null}
            清理已合并
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-2">
          {error && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded border border-red-500/30 bg-red-500/5 px-2 py-1 text-xs text-red-600">
              <span className="truncate">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="shrink-0 rounded p-0.5 transition-colors hover:bg-red-500/10"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {loading && workspaces === null ? (
            <div className="flex justify-center py-3">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-fg-5 border-t-transparent" />
            </div>
          ) : count === 0 ? (
            <p className="py-2 text-center text-xs text-fg-5">暂无工作空间</p>
          ) : (
            <ul className="space-y-1">
              {workspaces?.map((ws) => {
                const isTempBranch = ws.branch.startsWith(WS_BRANCH_PREFIX)
                const branchTail = isTempBranch ? ws.branch.slice(WS_BRANCH_PREFIX.length) : ws.branch
                const statusColor =
                  ws.status === "active"
                    ? "bg-emerald-500/10 text-emerald-600"
                    : ws.status === "idle"
                      ? "bg-amber-500/10 text-amber-600"
                      : "bg-fg-6/30 text-fg-4"
                const statusLabel =
                  ws.status === "active"
                    ? "活跃"
                    : ws.status === "idle"
                      ? "空闲"
                      : ws.status === "merged"
                        ? "已合并"
                        : ws.status === "stale"
                          ? "陈旧"
                          : ws.status
                const canDelete = ws.status !== "active"
                return (
                  <li
                    key={ws.id}
                    className="flex items-center gap-2 rounded-md border border-line bg-elevated/40 px-2 py-1.5 text-xs"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      {ws.running && ws.port && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                          title={`运行中 :${ws.port}`}
                        />
                      )}
                      <span className="min-w-0 truncate font-mono">
                        {isTempBranch && <span className="text-fg-5">{WS_BRANCH_PREFIX}</span>}
                        <span className="text-fg-2">{branchTail}</span>
                      </span>
                    </div>
                    <span
                      className={clsx(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                        statusColor,
                      )}
                    >
                      {statusLabel}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5 text-fg-5">
                      <HardDrive className="h-2.5 w-2.5" />
                      {formatBytes(ws.diskUsage)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleRemove(ws.id)}
                      disabled={!canDelete || removingId === ws.id}
                      title={canDelete ? "删除工作空间" : "活跃工作空间无法删除"}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-5 transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-5"
                    >
                      {removingId === ws.id ? (
                        <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

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
  const addToast = useToastStore((s) => s.addToast)
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

    try {
      const result = await api.pullRepo(repoId)
      await loadRepos()
      const variant = result.alreadyUpToDate ? "info" : "success"
      addToast(result.summary, variant, undefined, { persistent: true })
    } catch (err) {
      let message = "拉取失败"
      if (err instanceof api.ApiError) {
        try { message = JSON.parse(err.message).error ?? err.message } catch { message = err.message }
      }
      addToast(message, "error", undefined, { persistent: true })
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                      <dd className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{repo.localPath}</span>
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(repo.localPath)}
                          title="复制路径"
                          className="shrink-0 rounded p-0.5 text-fg-5 transition-colors hover:text-fg-3"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </dd>
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
                      onClick={async () => {
                        const next = repo.runtimeType === "claude-code" ? "opencode" : "claude-code"
                        await api.switchRuntime(repo.id, next)
                        loadRepos()
                      }}
                      className={clsx(
                        "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                        repo.runtimeType === "claude-code"
                          ? "border-orange-500/30 text-orange-600 hover:bg-orange-500/10"
                          : "border-sky-500/30 text-sky-600 hover:bg-sky-500/10",
                      )}
                      title={`当前运行时: ${repo.runtimeType === "claude-code" ? "Claude Code" : "OpenCode"}，点击切换`}
                    >
                      {repo.runtimeType === "claude-code" ? "Claude" : "OpenCode"}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.toggleWorktree(repo.id, !repo.worktreeEnabled)
                        loadRepos()
                      }}
                      className={clsx(
                        "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                        repo.worktreeEnabled
                          ? "border-violet-500/30 text-violet-600 hover:bg-violet-500/10"
                          : "border-line text-fg-4 hover:bg-elevated hover:text-fg-2",
                      )}
                      title={repo.worktreeEnabled ? "Worktree 已开启" : "Worktree 已关闭"}
                    >
                      <GitBranch className="h-3 w-3" />Worktree
                    </button>
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

                  {repo.worktreeEnabled && <WorkspacesSection repoId={repo.id} />}
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

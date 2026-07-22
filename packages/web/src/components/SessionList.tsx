import { useState } from "react"
import { Check, FolderGit2, Monitor, Moon, Plus, Sun, Terminal, Trash2, X } from "lucide-react"
import clsx from "clsx"
import type { Session } from "../lib/api-client"
import { useSessionStore } from "../stores/session-store"
import { useAgentStore } from "../stores/agent-store"
import { useThemeStore } from "../stores/theme-store"
import { useRepoStore } from "../stores/repo-store"

function sessionTime(session: Session): number {
  if (typeof session.time?.created === "number") {
    return session.time.created
  }
  if (session.createdAt) {
    const parsed = Date.parse(session.createdAt)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

function formatWhen(session: Session): string {
  const raw = sessionTime(session)
  if (!raw) {
    return ""
  }
  const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw
  const date = new Date(ms)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function statusDotClass(status: string | undefined): string {
  switch (status) {
    case "idle":
      return "bg-emerald-500"
    case "busy":
    case "retry":
      return "bg-amber-500 animate-pulse"
    case "error":
      return "bg-red-500"
    default:
      return "bg-fg-5"
  }
}

function RepoSelector() {
  const repos = useRepoStore((state) => state.repos)
  const activeRepoId = useRepoStore((state) => state.activeRepoId)
  const setActiveRepo = useRepoStore((state) => state.setActiveRepo)
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState("")
  const [gitUrl, setGitUrl] = useState("")
  const [localPath, setLocalPath] = useState("")
  const [resolving, setResolving] = useState(false)
  const addRepo = useRepoStore((state) => state.addRepo)
  const removeRepo = useRepoStore((state) => state.removeRepo)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const canSubmit = name.trim() !== "" && gitUrl.trim() !== "" && localPath.trim() !== "" && !resolving

  const handleResolvePath = async (path: string) => {
    const trimmed = path.trim()
    if (!trimmed) return
    setResolving(true)
    try {
      const result = await import("../lib/api-client").then((m) => m.resolveRepo(trimmed))
      if (result.name && !name.trim()) setName(result.name)
      if (result.gitUrl && !gitUrl.trim()) setGitUrl(result.gitUrl)
    } catch {}
    setResolving(false)
  }

  const handleAdd = async () => {
    if (!canSubmit) return
    await addRepo(name.trim(), gitUrl.trim(), localPath.trim())
    setName("")
    setGitUrl("")
    setLocalPath("")
    setShowAdd(false)
  }

  return (
    <section className="border-b border-line">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <FolderGit2 className="h-4 w-4 shrink-0 text-fg-4" />
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-fg-3">
            代码仓库
          </h2>
          {repos.length > 0 && (
            <span className="rounded-full bg-elevated px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-fg-3">
              {repos.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          aria-label="Add repository"
          className={clsx(
            "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
            showAdd
              ? "border-line-hard bg-elevated text-fg"
              : "border-line text-fg-3 hover:border-line-hard hover:bg-elevated hover:text-fg",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          添加
        </button>
      </div>

      {repos.length > 0 && (
        <div className="max-h-52 space-y-1 overflow-y-auto px-2 pb-2">
          {repos.map((r) => {
            const isActive = r.id === activeRepoId
            return (
              <div
                key={r.id}
                className={clsx(
                  "group flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors",
                  isActive
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-transparent hover:border-line hover:bg-elevated/50",
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveRepo(r.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span
                    className={clsx(
                      "h-2 w-2 shrink-0 rounded-full",
                      r.running ? "bg-emerald-500 ring-2 ring-emerald-500/25" : "bg-fg-5",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={clsx(
                        "block truncate text-sm font-medium leading-tight",
                        isActive ? "text-fg" : "text-fg-2",
                      )}
                    >
                      {r.name}
                    </span>
                    <span
                      className={clsx(
                        "mt-0.5 block text-[11px] leading-tight",
                        r.running ? "text-emerald-500" : "text-fg-5",
                      )}
                    >
                      {r.running ? "运行中" : "已停止"}
                    </span>
                  </span>
                </button>
                {confirmingId === r.id ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        void removeRepo(r.id)
                        setConfirmingId(null)
                      }}
                      aria-label="Confirm delete"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-red-500 transition-colors hover:bg-red-500/10"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      aria-label="Cancel delete"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(r.id)}
                    aria-label="Delete repository"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-5 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {repos.length === 0 && !showAdd && (
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-line-hard px-3 py-5 text-fg-4 transition-colors hover:border-emerald-500/50 hover:bg-elevated/40 hover:text-fg-3"
          >
            <FolderGit2 className="h-5 w-5" />
            <span className="text-xs font-medium text-fg-3">暂无代码仓库</span>
            <span className="text-[11px] text-fg-5">添加一个开始使用</span>
          </button>
        </div>
      )}

      {showAdd && (
        <div className="border-t border-line bg-base/50 px-3 py-3">
          <h3 className="mb-3 text-xs font-semibold text-fg-2">新建仓库</h3>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="repo-name" className="text-[11px] font-medium text-fg-3">
                名称
              </label>
              <input
                id="repo-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-project"
                className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-fg transition-colors placeholder:text-fg-5 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="repo-git" className="text-[11px] font-medium text-fg-3">
                Git 远程地址
              </label>
              <input
                id="repo-git"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/org/repo.git"
                className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs text-fg transition-colors placeholder:text-fg-5 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="repo-path" className="text-[11px] font-medium text-fg-3">
                本地路径
              </label>
              <input
                id="repo-path"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                onBlur={(e) => void handleResolvePath(e.target.value)}
                placeholder="/Users/you/code/repo"
                className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs text-fg transition-colors placeholder:text-fg-5 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
              <span className="text-[10px] text-fg-5">
                {resolving ? "正在读取 Git 信息…" : "输入路径后自动读取仓库信息"}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!canSubmit}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6 disabled:text-fg-4"
              >
                添加仓库
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export function SessionList({ onNavigate }: { onNavigate?: () => void }) {
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState("")
  const [agent, setAgent] = useState("")
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const sessions = useSessionStore((state) => state.sessions)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const statuses = useSessionStore((state) => state.sessionStatuses)
  const createSession = useSessionStore((state) => state.createSession)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const deleteSession = useSessionStore((state) => state.deleteSession)
  const agents = useAgentStore((state) => state.agents)
  const activeRepoId = useRepoStore((state) => state.activeRepoId)

  const ordered = [...sessions]
    .filter((s) => !s.parentID)
    .sort((a, b) => sessionTime(b) - sessionTime(a))

  const handleCreate = async () => {
    const text = draft.trim()
    if (!text) {
      return
    }
    setDraft("")
    setShowForm(false)
    await createSession(text, agent || undefined)
    onNavigate?.()
  }

  const handleSelect = (id: string) => {
    void setActiveSession(id)
    onNavigate?.()
  }

  const preference = useThemeStore((state) => state.preference)
  const cycle = useThemeStore((state) => state.cycle)

  const ThemeIcon = preference === "light" ? Sun : preference === "dark" ? Moon : Monitor

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-emerald-400" />
          <h1 className="text-sm font-semibold tracking-tight text-fg">
            Fourth Spark
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={cycle}
            aria-label={`Theme: ${preference}`}
            title={`Theme: ${preference}`}
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
          >
            <ThemeIcon className="h-4 w-4" />
          </button>
          {activeRepoId && (
            <button
              type="button"
              onClick={() => setShowForm((value) => !value)}
              aria-label="新建运行"
              title="新建运行"
              className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-white transition-colors hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <RepoSelector />

      {showForm && activeRepoId && (
        <div className="flex flex-col gap-2 border-b border-line bg-base/60 p-3">
          {agents.length > 0 && (
            <select
              value={agent}
              onChange={(event) => setAgent(event.target.value)}
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg focus:border-emerald-500 focus:outline-none"
            >
              <option value="">默认 Agent</option>
              {agents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
          <textarea
            value={draft}
            rows={3}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            placeholder="让 Agent 做什么？"
            className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg placeholder:text-fg-5 focus:border-emerald-500 focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setDraft("")
              }}
              className="rounded-md px-3 py-1.5 text-xs text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={draft.trim().length === 0}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6 disabled:text-fg-4"
            >
              开始运行
            </button>
          </div>
        </div>
      )}

      <div className="px-3 pb-1 pt-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-fg-5">
          运行记录
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {!activeRepoId ? (
          <p className="px-2 py-6 text-center font-mono text-xs text-fg-5">
            添加一个仓库开始使用
          </p>
        ) : ordered.length === 0 ? (
          <p className="px-2 py-6 text-center font-mono text-xs text-fg-5">
            暂无运行记录，点击上方开始
          </p>
        ) : (
          <ul className="space-y-0.5">
            {ordered.map((session) => {
              const isActive = session.id === activeSessionId
              const isConfirming = confirmingId === session.id
              const when = formatWhen(session)
              return (
                <li key={session.id}>
                  <div
                    className={clsx(
                      "group relative rounded-md border-l-2 transition-colors",
                      isActive
                        ? "border-emerald-500 bg-elevated/80"
                        : "border-transparent hover:bg-elevated/50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(session.id)}
                      className="block w-full px-2.5 py-2 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={clsx(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            statusDotClass(statuses.get(session.id)),
                          )}
                        />
                        <span className="min-w-0 truncate font-mono text-xs text-fg-3">
                          {session.agent?.trim() || "默认"}
                        </span>
                        {when && (
                          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-fg-5">
                            {when}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate pl-3.5 text-sm text-fg-2">
                        {session.title?.trim() || "未命名运行"}
                      </div>
                    </button>
                    {isConfirming ? (
                      <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-surface/90 px-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            void deleteSession(session.id)
                            setConfirmingId(null)
                          }}
                          aria-label="Confirm delete"
                          className="rounded p-1 text-red-400 hover:bg-red-500/10"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          aria-label="Cancel delete"
                          className="rounded p-1 text-fg-3 hover:bg-elevated"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingId(session.id)}
                        aria-label="Delete run"
                        className="absolute right-1.5 top-1.5 rounded p-1 text-fg-5 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

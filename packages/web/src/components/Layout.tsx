import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import { Bot, Box, Check, ChevronDown, ChevronsLeft, ChevronsRight, CircleDot, GitBranch, GitPullRequest, Loader2, Monitor, Moon, Play, Settings, Sun, Zap } from "lucide-react"
import clsx from "clsx"
import { useCallback, useEffect, useRef, useState } from "react"
import { useThemeStore } from "../stores/theme-store"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { useLayoutStore } from "../stores/layout-store"
import { listBranches, checkoutBranch, type BranchList } from "../lib/api-client"

const NAV_ITEMS = [
  { segment: "repos", icon: Box, label: "仓库管理", global: true },
  { segment: "run", icon: Play, label: "运行面板", global: false },
  { segment: "agents", icon: Bot, label: "Agents", global: false },
  { segment: "issues", icon: CircleDot, label: "Issues", global: false },
  { segment: "pulls", icon: GitPullRequest, label: "PRs", global: false },
  { segment: "settings", icon: Settings, label: "设置", global: true },
]

function navPath(segment: string, global: boolean, repoName: string | null): string {
  if (global) return `/${segment}`
  return repoName ? `/${encodeURIComponent(repoName)}/${segment}` : `/${segment}`
}

function shortRepoName(name: string): string {
  const idx = name.lastIndexOf("/")
  return idx >= 0 ? name.slice(idx + 1) : name
}

function RepoSwitcher({
  repos,
  activeRepoId,
  onRepoChange,
}: {
  repos: Array<{ id: string; name: string }>
  activeRepoId: string | null
  onRepoChange: (repoId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const activeRepo = repos.find((r) => r.id === activeRepoId)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open, close])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[140px] items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-xs text-fg-2 transition-colors hover:border-blue-500 sm:max-w-[200px]"
      >
        <Box className="h-3 w-3 shrink-0 text-fg-4" />
        <span className="truncate">
          <span className="sm:hidden">{activeRepo ? shortRepoName(activeRepo.name) : ""}</span>
          <span className="hidden sm:inline">{activeRepo?.name ?? ""}</span>
        </span>
        <ChevronDown className={clsx("h-3 w-3 shrink-0 text-fg-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <div className="max-h-64 overflow-y-auto py-1">
            {repos.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => { onRepoChange(r.id); close() }}
                className={clsx(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                  r.id === activeRepoId
                    ? "font-medium text-blue-600"
                    : "text-fg-2 hover:bg-elevated",
                )}
              >
                {r.id === activeRepoId ? (
                  <Check className="h-3 w-3 shrink-0" />
                ) : (
                  <span className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate">{r.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BranchSwitcher({ repoId, currentBranch }: { repoId: string; currentBranch: string | null }) {
  const updateRepoBranch = useRepoStore((s) => s.updateRepoBranch)
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<BranchList | null>(null)
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    setError(null)
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open, close])

  const handleOpen = async () => {
    if (open) { close(); return }
    setOpen(true)
    setLoading(true)
    setError(null)
    try {
      setBranches(await listBranches(repoId))
    } catch {
      setError("加载分支失败")
    } finally {
      setLoading(false)
    }
  }

  const handleCheckout = async (branch: string) => {
    if (branch === currentBranch || switching) return
    setSwitching(branch)
    setError(null)
    try {
      const result = await checkoutBranch(repoId, branch)
      updateRepoBranch(repoId, result.branch)
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换失败")
    } finally {
      setSwitching(null)
    }
  }

  if (!currentBranch) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-1 rounded-md bg-elevated px-2 py-1 text-xs text-fg-3 transition-colors hover:bg-blue-500/10 hover:text-blue-600"
      >
        <GitBranch className="h-3 w-3" />
        {currentBranch}
        <ChevronDown className={clsx("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-fg-4" />
            </div>
          ) : branches ? (
            <div className="max-h-64 overflow-y-auto py-1">
              {branches.local.map((b) => (
                <button
                  key={b}
                  type="button"
                  disabled={switching !== null}
                  onClick={() => handleCheckout(b)}
                  className={clsx(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                    b === currentBranch
                      ? "font-medium text-blue-600"
                      : "text-fg-2 hover:bg-elevated",
                  )}
                >
                  {b === currentBranch ? (
                    <Check className="h-3 w-3 shrink-0" />
                  ) : switching === b ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  ) : (
                    <span className="h-3 w-3 shrink-0" />
                  )}
                  <span className="truncate">{b}</span>
                </button>
              ))}
              {branches.remote.length > 0 && (
                <>
                  <div className="mx-3 my-1 border-t border-line" />
                  <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-fg-4">Remote</div>
                  {branches.remote.map((b) => (
                    <button
                      key={`remote-${b}`}
                      type="button"
                      disabled={switching !== null}
                      onClick={() => handleCheckout(b)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-2 transition-colors hover:bg-elevated"
                    >
                      {switching === b ? (
                        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                      ) : (
                        <span className="h-3 w-3 shrink-0" />
                      )}
                      <span className="truncate">{b}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          ) : null}
          {error && (
            <div className="border-t border-line px-3 py-2 text-xs text-red-500">{error}</div>
          )}
        </div>
      )}
    </div>
  )
}

function useLatestVersion() {
  const [latest, setLatest] = useState<string | null>(null)
  useEffect(() => {
    const check = () =>
      fetch("/api/health")
        .then((r) => r.json())
        .then((d: { latestVersion?: string }) => {
          if (d.latestVersion && d.latestVersion !== __APP_VERSION__) setLatest(d.latestVersion)
        })
        .catch(() => {})

    check()
    const id = setInterval(check, 30 * 60_000)
    const onFocus = () => check()
    window.addEventListener("focus", onFocus)
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus) }
  }, [])
  return latest
}

function Header() {
  const navigate = useNavigate()
  const location = useLocation()
  const repos = useRepoStore((s) => s.repos)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const setActiveRepo = useRepoStore((s) => s.setActiveRepo)
  const preference = useThemeStore((s) => s.preference)
  const cycle = useThemeStore((s) => s.cycle)
  const ThemeIcon = preference === "light" ? Sun : preference === "dark" ? Moon : Monitor
  const activeRepo = repos.find((r) => r.id === activeRepoId)
  const latestVersion = useLatestVersion()

  const handleRepoChange = (newRepoId: string) => {
    if (!newRepoId) return
    setActiveRepo(newRepoId)
    const repo = repos.find((r) => r.id === newRepoId)
    if (!repo) return
    const subPage = location.pathname.match(/\/(run|issues|pulls)/)?.[1] ?? "run"
    navigate(`/${encodeURIComponent(repo.name)}/${subPage}`)
  }

  return (
    <header className="shrink-0 border-b border-line bg-surface pt-[var(--safe-top)]">
      <div className="flex h-12 items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <Zap className="h-5 w-5 text-blue-500" />
          <span className="hidden text-sm font-bold tracking-tight text-fg sm:inline">Fourth Spark</span>
          <span className="hidden rounded bg-elevated px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-fg-4 sm:inline">
            v{__APP_VERSION__}
          </span>
          {latestVersion && (
            <span className="hidden text-[10px] text-amber-500 sm:inline">
              → v{latestVersion} 可用，运行 <code className="rounded bg-amber-500/10 px-1 font-mono">fourth-spark upgrade</code> 更新
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {repos.length > 0 && (
            <div className="flex items-center gap-2">
              <RepoSwitcher repos={repos} activeRepoId={activeRepoId} onRepoChange={handleRepoChange} />
              {activeRepo && activeRepoId && (
                <BranchSwitcher repoId={activeRepoId} currentBranch={activeRepo.branch} />
              )}
            </div>
          )}
          <a
            href="https://github.com/kinminghao/fourth-spark"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="flex h-8 w-8 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
          </a>
          <button
            type="button"
            onClick={cycle}
            aria-label={`主题: ${preference}`}
            className="flex h-8 w-8 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
          >
            <ThemeIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      {latestVersion && (
        <div className="border-t border-line px-4 py-1.5 sm:hidden">
          <span className="text-[10px] text-amber-500">
            → v{latestVersion} 可用，运行 <code className="rounded bg-amber-500/10 px-1 font-mono">fourth-spark upgrade</code> 更新
          </span>
        </div>
      )}
    </header>
  )
}

function Sidebar() {
  const repoName = useRepoStore(selectActiveRepoName)
  const collapsed = useLayoutStore((s) => s.navCollapsed)
  const toggle = useLayoutStore((s) => s.toggleNav)

  return (
    <nav
      className={clsx(
        "hidden shrink-0 flex-col border-r border-line bg-surface py-2 transition-[width] duration-200 ease-in-out md:flex",
        collapsed ? "w-14" : "w-48",
      )}
    >
      <div className="flex flex-1 flex-col">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.segment}
            to={navPath(item.segment, item.global, repoName)}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              clsx(
                "mx-2 flex items-center rounded-md py-2 text-sm transition-colors",
                collapsed ? "justify-center px-2" : "gap-2.5 px-3",
                isActive
                  ? "bg-blue-500/10 font-medium text-blue-600"
                  : "text-fg-3 hover:bg-elevated hover:text-fg",
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span
              className={clsx(
                "truncate transition-[opacity,max-width] duration-200 ease-in-out",
                collapsed ? "max-w-0 opacity-0" : "max-w-[8rem] opacity-100",
              )}
            >
              {item.label}
            </span>
          </NavLink>
        ))}
      </div>

      <button
        type="button"
        onClick={toggle}
        title={collapsed ? "展开导航" : "收起导航"}
        className="mx-2 flex items-center justify-center rounded-md py-2 text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
      >
        {collapsed
          ? <ChevronsRight className="h-4 w-4" />
          : <ChevronsLeft className="h-4 w-4" />
        }
      </button>
    </nav>
  )
}

function BottomBar() {
  const repoName = useRepoStore(selectActiveRepoName)
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-line bg-surface pb-[var(--safe-bottom)] md:hidden">
      <div className="flex h-14 items-center justify-around">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.segment}
            to={navPath(item.segment, item.global, repoName)}
            aria-label={item.label}
            className={({ isActive }) =>
              clsx(
                "flex h-10 w-10 items-center justify-center rounded-md transition-colors",
                isActive
                  ? "bg-blue-500/10 text-blue-600"
                  : "text-fg-3 hover:bg-elevated hover:text-fg",
              )
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

export function Layout() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-base text-fg">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden pb-[calc(3.5rem_+_var(--safe-bottom))] md:pb-0">
          <Outlet />
        </main>
      </div>
      <BottomBar />
    </div>
  )
}

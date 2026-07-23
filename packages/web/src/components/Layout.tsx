import { NavLink, Outlet } from "react-router-dom"
import { Box, CircleDot, Monitor, Moon, Play, Settings, Sun, Zap } from "lucide-react"
import clsx from "clsx"
import { useThemeStore } from "../stores/theme-store"
import { useRepoStore } from "../stores/repo-store"

const NAV_ITEMS = [
  { to: "/repos", icon: Box, label: "仓库管理" },
  { to: "/run", icon: Play, label: "运行面板" },
  { to: "/issues", icon: CircleDot, label: "Issues" },
  { to: "/settings", icon: Settings, label: "设置" },
]

function Header() {
  const repos = useRepoStore((s) => s.repos)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const setActiveRepo = useRepoStore((s) => s.setActiveRepo)
  const preference = useThemeStore((s) => s.preference)
  const cycle = useThemeStore((s) => s.cycle)
  const ThemeIcon = preference === "light" ? Sun : preference === "dark" ? Moon : Monitor

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface px-4">
      <div className="flex items-center gap-2.5">
        <Zap className="h-5 w-5 text-blue-500" />
        <span className="text-sm font-bold tracking-tight text-fg">Fourth Spark</span>
      </div>

      <div className="flex items-center gap-3">
        {repos.length > 0 && (
          <select
            value={activeRepoId ?? ""}
            onChange={(e) => setActiveRepo(e.target.value || null)}
            className="rounded-md border border-line bg-base px-2.5 py-1 text-xs text-fg-2 focus:border-blue-500 focus:outline-none"
          >
            {repos.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={cycle}
          aria-label={`主题: ${preference}`}
          className="flex h-8 w-8 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"
        >
          <ThemeIcon className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}

function Sidebar() {
  return (
    <nav className="flex w-48 shrink-0 flex-col border-r border-line bg-surface py-2">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            clsx(
              "mx-2 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-blue-500/10 font-medium text-blue-600"
                : "text-fg-3 hover:bg-elevated hover:text-fg",
            )
          }
        >
          <item.icon className="h-4 w-4 shrink-0" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function Layout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-base text-fg">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

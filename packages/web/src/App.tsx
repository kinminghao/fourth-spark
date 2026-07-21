import { useEffect, useState } from "react"
import { WifiOff, X } from "lucide-react"
import clsx from "clsx"
import { SessionList } from "./components/SessionList"
import { ChatView } from "./components/ChatView"
import { useSessionStore } from "./stores/session-store"
import { useAgentStore } from "./stores/agent-store"

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const loadError = useSessionStore((state) => state.loadError)
  const loadSessions = useSessionStore((state) => state.loadSessions)

  useEffect(() => {
    void useSessionStore.getState().loadSessions()
    void useAgentStore.getState().loadAgents()
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 w-72 transform border-r border-zinc-800 transition-transform duration-200 md:static md:z-auto md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <SessionList onNavigate={() => setSidebarOpen(false)} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <ChatView onToggleSidebar={() => setSidebarOpen((value) => !value)} />
      </main>

      {loadError && (
        <div className="fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-red-500/30 bg-red-950/90 px-3 py-2 text-xs text-red-300 shadow-lg backdrop-blur">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          <span>Cannot reach backend.</span>
          <button
            type="button"
            onClick={() => void loadSessions()}
            className="rounded bg-red-500/20 px-1.5 py-0.5 font-medium transition-colors hover:bg-red-500/30"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => useSessionStore.setState({ loadError: null })}
            aria-label="Dismiss"
            className="rounded p-0.5 hover:bg-red-500/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

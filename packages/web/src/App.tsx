import { useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { Layout } from "./components/Layout"
import { ReposPage } from "./pages/ReposPage"
import { RunPage } from "./pages/RunPage"
import { SettingsPage } from "./pages/SettingsPage"
import { useRepoStore } from "./stores/repo-store"
import { useSessionStore } from "./stores/session-store"
import { useAgentStore } from "./stores/agent-store"
import { useIssueStore } from "./stores/issue-store"
import { useThemeStore } from "./stores/theme-store"

export default function App() {
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const loadSessions = useSessionStore((s) => s.loadSessions)
  const clearSessions = useSessionStore((s) => s.clearSessions)

  useEffect(() => {
    void useRepoStore.getState().loadRepos()
    return useThemeStore.getState().init()
  }, [])

  useEffect(() => {
    if (activeRepoId) {
      clearSessions()
      void loadSessions()
      void useAgentStore.getState().loadAgents()
      void useIssueStore.getState().loadIssues()
    } else {
      clearSessions()
    }
  }, [activeRepoId, loadSessions, clearSessions])

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/repos" element={<ReposPage />} />
          <Route path="/run" element={<RunPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/repos" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

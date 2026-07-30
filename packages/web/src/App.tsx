import { useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom"
import { Layout } from "./components/Layout"
import { ReposPage } from "./pages/ReposPage"
import { RunPage } from "./pages/RunPage"
import { IssuesPage } from "./pages/IssuesPage"
import { PullRequestsPage } from "./pages/PullRequestsPage"
import { SettingsPage } from "./pages/SettingsPage"
import { useRepoStore } from "./stores/repo-store"
import { useSessionStore } from "./stores/session-store"
import { useCustomAgentStore } from "./stores/custom-agent-store"
import { useIssueStore } from "./stores/issue-store"
import { usePrStore } from "./stores/pr-store"
import { useThemeStore } from "./stores/theme-store"
import { ToastContainer } from "./components/ToastContainer"
import { orchestrator } from "./lib/session-orchestrator"
import { initPushNotifications } from "./lib/push-notifications"

function AppInner() {
  const navigate = useNavigate()
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const loadSessions = useSessionStore((s) => s.loadSessions)
  const clearSessions = useSessionStore((s) => s.clearSessions)
  useEffect(() => {
    void useRepoStore.getState().loadRepos()
    void initPushNotifications(navigate)
    return useThemeStore.getState().init()
  }, [navigate])

  useEffect(() => {
    if (activeRepoId) {
      clearSessions()
      useIssueStore.getState().clearIssues()
      usePrStore.getState().clearPulls()
      void loadSessions()
      void useCustomAgentStore.getState().loadAgents()
      void useIssueStore.getState().loadIssues()
      void usePrStore.getState().loadPulls()
      orchestrator.start(activeRepoId)
    } else {
      clearSessions()
      useIssueStore.getState().clearIssues()
      usePrStore.getState().clearPulls()
    }
    return () => orchestrator.stop()
  }, [activeRepoId, loadSessions, clearSessions])

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/repos" element={<ReposPage />} />
          <Route path="/run" element={<RunPage />} />
          <Route path="/issues" element={<IssuesPage />} />
          <Route path="/pulls" element={<PullRequestsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/repos" replace />} />
        </Route>
      </Routes>
      <ToastContainer />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  )
}

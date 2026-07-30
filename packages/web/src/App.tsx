import { useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom"
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

function extractRepoIdFromUrl(pathname: string): string | null {
  const match = pathname.match(/^\/([^/]+)\/(run|issues|pulls)/)
  return match ? match[1] : null
}

function DefaultRedirect() {
  const repos = useRepoStore((s) => s.repos)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const fallbackId = activeRepoId ?? (repos.length > 0 ? repos[0].id : null)
  if (fallbackId) return <Navigate to={`/${fallbackId}/run`} replace />
  return <Navigate to="/repos" replace />
}

function AppInner() {
  const navigate = useNavigate()
  const location = useLocation()
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const repos = useRepoStore((s) => s.repos)
  const setActiveRepo = useRepoStore((s) => s.setActiveRepo)
  const loadSessions = useSessionStore((s) => s.loadSessions)
  const clearSessions = useSessionStore((s) => s.clearSessions)

  useEffect(() => {
    void useRepoStore.getState().loadRepos()
    void initPushNotifications(navigate)
    return useThemeStore.getState().init()
  }, [navigate])

  useEffect(() => {
    if (repos.length === 0) return
    const urlRepoId = extractRepoIdFromUrl(location.pathname)
    if (!urlRepoId) return
    const currentActive = useRepoStore.getState().activeRepoId
    if (urlRepoId !== currentActive && repos.some((r) => r.id === urlRepoId)) {
      setActiveRepo(urlRepoId)
    }
  }, [location.pathname, repos, setActiveRepo])

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
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/:repoId/run" element={<RunPage />} />
          <Route path="/:repoId/issues" element={<IssuesPage />} />
          <Route path="/:repoId/pulls" element={<PullRequestsPage />} />
          <Route path="/:repoId" element={<Navigate to="run" replace />} />
          <Route path="*" element={<DefaultRedirect />} />
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

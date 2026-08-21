import { useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom"
import { Layout } from "./components/Layout"
import { ReposPage } from "./pages/ReposPage"
import { RunPage } from "./pages/RunPage"
import { IssuesPage } from "./pages/IssuesPage"
import { PullRequestsPage } from "./pages/PullRequestsPage"
import { AgentsPage } from "./pages/AgentsPage"
import { AgentDetailPage } from "./pages/AgentDetailPage"
import { SettingsPage } from "./pages/SettingsPage"
import { useRepoStore, selectActiveRepoName } from "./stores/repo-store"
import { useSessionStore } from "./stores/session-store"
import { useCustomAgentStore } from "./stores/custom-agent-store"
import { useIssueStore } from "./stores/issue-store"
import { usePrStore } from "./stores/pr-store"
import { useThemeStore } from "./stores/theme-store"
import { ToastContainer } from "./components/ToastContainer"
import { orchestrator } from "./lib/session-orchestrator"
import { initPushNotifications } from "./lib/push-notifications"

function extractRepoSlugFromUrl(pathname: string): string | null {
  const match = pathname.match(/^\/([^/]+)\/(run|agents|issues|pulls)/)
  return match ? decodeURIComponent(match[1]) : null
}

function DefaultRedirect() {
  const repos = useRepoStore((s) => s.repos)
  const activeRepoName = useRepoStore(selectActiveRepoName)
  const fallbackName = activeRepoName ?? (repos.length > 0 ? repos[0].name : null)
  if (fallbackName) return <Navigate to={`/${encodeURIComponent(fallbackName)}/run`} replace />
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
    const urlSlug = extractRepoSlugFromUrl(location.pathname)
    if (!urlSlug) return
    const matched = repos.find((r) => r.name === urlSlug)
    if (matched && matched.id !== useRepoStore.getState().activeRepoId) {
      setActiveRepo(matched.id)
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
          <Route path="/:repoId/agents" element={<AgentsPage />} />
          <Route path="/:repoId/agents/:agentId" element={<AgentDetailPage />} />
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

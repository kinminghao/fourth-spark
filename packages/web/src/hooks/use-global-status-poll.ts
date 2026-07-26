import { useEffect } from "react"
import { useRepoStore } from "../stores/repo-store"
import { useSessionStore } from "../stores/session-store"
import * as api from "../lib/api-client"

const POLL_MS = 1_000

export function useGlobalStatusPoll(): void {
  const repoId = useRepoStore((s) => s.activeRepoId)

  useEffect(() => {
    if (!repoId) return
    let disposed = false

    const poll = async () => {
      if (disposed) return
      const store = useSessionStore.getState()
      const sessions = store.sessions

      void store.loadSessions()

      const promises = sessions.map(async (session) => {
        if (disposed) return
        try {
          const status = await api.getSessionStatus(repoId, session.id)
          if (status?.type) {
            useSessionStore.getState().setSessionStatus(session.id, status.type)
          }
        } catch {
        }
      })
      await Promise.all(promises)
    }

    const timer = setInterval(poll, POLL_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [repoId])
}

import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { getSessionStatus } from "../lib/api-client"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { useSessionStore } from "../stores/session-store"
import { useToastStore } from "../stores/toast-store"

const POLL_INTERVAL_MS = 2000

export type PolishPhase = "idle" | "polishing" | "preview"

/**
 * Shared AI-polish state machine: idle → polishing → preview.
 *
 * Callers supply two async callbacks that vary by use-case:
 *   - `startPolish`  – kick off the agent session, return its id
 *   - `fetchResult`  – pull the finished draft once the session is idle
 *
 * Optional:
 *   - `loadExisting` – check for a previously-saved draft on mount
 *   - `cleanup`      – delete the server-side draft on discard
 */
export function useAiPolish<T>({
  repoId,
  startPolish,
  fetchResult,
  loadExisting,
  cleanup,
}: {
  repoId: string | null
  startPolish: () => Promise<{ sessionId: string }>
  fetchResult: () => Promise<T>
  loadExisting?: () => Promise<T | null>
  cleanup?: () => Promise<void>
}) {
  const navigate = useNavigate()
  const repoName = useRepoStore(selectActiveRepoName)

  const [phase, setPhase] = useState<PolishPhase>("idle")
  const [result, setResult] = useState<T | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  // Load existing draft on mount
  useEffect(() => {
    if (!repoId || !loadExisting) return
    let cancelled = false
    loadExisting()
      .then((existing) => {
        if (!cancelled && existing) {
          setResult(existing)
          setPhase("preview")
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  // loadExisting identity should be stable (useCallback at call-site)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId])

  const polish = useCallback(async () => {
    if (!repoId || phase === "polishing") return
    setPhase("polishing")
    try {
      const { sessionId: sid } = await startPolish()
      setSessionId(sid)

      pollRef.current = setInterval(async () => {
        try {
          const status = await getSessionStatus(repoId, sid)
          if (status.type === "idle") {
            stopPolling()
            const r = await fetchResult()
            setResult(r)
            setPhase("preview")
          }
        } catch {
          stopPolling()
          setPhase("idle")
          useToastStore.getState().addToast("润色状态检查失败", "error")
        }
      }, POLL_INTERVAL_MS)
    } catch (err) {
      setPhase("idle")
      useToastStore.getState().addToast(
        err instanceof Error ? err.message : "润色启动失败",
        "error",
      )
    }
  }, [repoId, phase, startPolish, fetchResult, stopPolling])

  const discard = useCallback(() => {
    stopPolling()
    cleanup?.().catch(() => {})
    setResult(null)
    setSessionId(null)
    setPhase("idle")
  }, [stopPolling, cleanup])

  const escalate = useCallback(() => {
    if (!sessionId || !repoName) return
    useSessionStore.setState({ activeSessionId: sessionId })
    navigate(`/${encodeURIComponent(repoName)}/run`)
  }, [sessionId, repoName, navigate])

  return {
    phase,
    result,
    sessionId,
    busy,
    setBusy,
    polish,
    discard,
    escalate,
    setResult,
    setPhase,
  } as const
}

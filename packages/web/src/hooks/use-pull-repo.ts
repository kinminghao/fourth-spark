import { useState } from "react"
import { pullRepo } from "../lib/api-client"
import { useRepoStore } from "../stores/repo-store"
import { useToastStore } from "../stores/toast-store"
import { parseError } from "./use-async-data"

/**
 * Shared "git pull" action for the active repo.
 *
 * Used by both the repo list (ReposPage) and the header project selector so
 * the pull behaviour — API call, repo refresh, result/error toasts — stays
 * identical everywhere.
 */
export function usePullRepo() {
  const loadRepos = useRepoStore((s) => s.loadRepos)
  const addToast = useToastStore((s) => s.addToast)
  const [pullingId, setPullingId] = useState<string | null>(null)

  const pull = async (repoId: string) => {
    setPullingId(repoId)
    try {
      const result = await pullRepo(repoId)
      await loadRepos()
      const variant = result.alreadyUpToDate ? "info" : "success"
      addToast(result.summary, variant, undefined, { persistent: true })
    } catch (err) {
      addToast(parseError(err, "拉取失败"), "error", undefined, { persistent: true })
    } finally {
      setPullingId(null)
    }
  }

  return { pull, pullingId }
}

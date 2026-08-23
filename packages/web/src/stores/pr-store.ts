import { create } from "zustand"
import * as api from "../lib/api-client"
import { ApiError } from "../lib/api-client"
import type { PersistentPullRequest } from "../lib/api-client"
import { useRepoStore } from "./repo-store"
import { useToastStore } from "./toast-store"

interface PrState {
  pulls: PersistentPullRequest[]
  loaded: boolean
  syncing: boolean
  selectedPrId: string | null
  viewingPrId: string | null
  matchingPrId: string | null
  matchingCandidateIssueId: string | null
  clearPulls: () => void
  setSelectedPr: (id: string | null) => void
  setViewingPr: (id: string | null) => void
  loadPulls: () => Promise<void>
  syncPulls: () => Promise<void>
  enterMatchMode: (prId: string) => void
  exitMatchMode: () => void
  setMatchCandidate: (issueId: string | null) => void
  linkIssue: (prNumber: number, issueNumber: number) => Promise<boolean>
  unlinkIssue: (prNumber: number, issueNumber: number) => Promise<boolean>
}

export const usePrStore = create<PrState>((set, get) => ({
  pulls: [],
  loaded: false,
  syncing: false,
  selectedPrId: null,
  viewingPrId: null,
  matchingPrId: null,
  matchingCandidateIssueId: null,

  clearPulls: () => set({
    pulls: [],
    loaded: false,
    selectedPrId: null,
    viewingPrId: null,
    matchingPrId: null,
    matchingCandidateIssueId: null,
  }),

  setSelectedPr: (id) => set({ selectedPrId: id }),
  setViewingPr: (id) => set({ viewingPrId: id }),

  enterMatchMode: (prId) => set({ matchingPrId: prId, matchingCandidateIssueId: null }),

  exitMatchMode: () => {
    const prId = get().matchingPrId
    set({ matchingPrId: null, matchingCandidateIssueId: null, selectedPrId: prId })
  },

  setMatchCandidate: (issueId) => set({ matchingCandidateIssueId: issueId }),

  linkIssue: async (prNumber, issueNumber) => {
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) return false
    try {
      await api.linkPrToIssue(repoId, prNumber, issueNumber)
      return true
    } catch {
      return false
    }
  },

  unlinkIssue: async (prNumber, issueNumber) => {
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) return false
    try {
      await api.unlinkPrFromIssue(repoId, prNumber, issueNumber)
      return true
    } catch {
      return false
    }
  },

  loadPulls: async () => {
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) {
      set({ pulls: [], loaded: true })
      return
    }
    try {
      const pulls = await api.listPulls(repoId, "all")
      set({ pulls, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  syncPulls: async () => {
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) return
    set({ syncing: true })
    try {
      await api.syncPulls(repoId, "open")
      const pulls = await api.listPulls(repoId, "all")
      set({ pulls, syncing: false })
    } catch (err) {
      set({ syncing: false })
      let message = "同步 PR 失败"
      if (err instanceof ApiError) {
        try {
          const body = JSON.parse(err.message)
          if (body.error) message = body.error
        } catch {
          if (err.message) message = err.message
        }
      }
      useToastStore.getState().addToast(message, "error")
    }
  },
}))

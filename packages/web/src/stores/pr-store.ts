import { create } from "zustand"
import * as api from "../lib/api-client"
import { ApiError } from "../lib/api-client"
import type { PersistentPullRequest } from "../lib/api-client"

/** Monotonic version counter for stale-response discarding. */
let _loadVersion = 0

interface PrState {
  pulls: PersistentPullRequest[]
  loaded: boolean
  syncing: boolean
  syncError: string | null
  selectedPrId: string | null
  viewingPrId: string | null
  matchingPrId: string | null
  matchingCandidateIssueId: string | null
  clearPulls: () => void
  setViewingPr: (id: string | null) => void
  loadPulls: (repoId: string) => Promise<void>
  syncPulls: (repoId: string) => Promise<void>
  enterMatchMode: (prId: string) => void
  exitMatchMode: () => void
  linkIssue: (repoId: string, prNumber: number, issueNumber: number) => Promise<boolean>
  unlinkIssue: (repoId: string, prNumber: number, issueNumber: number) => Promise<boolean>
}

export const usePrStore = create<PrState>((set, get) => ({
  pulls: [],
  loaded: false,
  syncing: false,
  syncError: null,
  selectedPrId: null,
  viewingPrId: null,
  matchingPrId: null,
  matchingCandidateIssueId: null,

  clearPulls: () => {
    ++_loadVersion
    set({
      pulls: [],
      loaded: false,
      syncError: null,
      selectedPrId: null,
      viewingPrId: null,
      matchingPrId: null,
      matchingCandidateIssueId: null,
    })
  },

  setViewingPr: (id) => set({ viewingPrId: id }),

  enterMatchMode: (prId) => set({ matchingPrId: prId, matchingCandidateIssueId: null }),

  exitMatchMode: () => {
    const prId = get().matchingPrId
    set({ matchingPrId: null, matchingCandidateIssueId: null, selectedPrId: prId })
  },

  linkIssue: async (repoId, prNumber, issueNumber) => {
    try {
      await api.linkPrToIssue(repoId, prNumber, issueNumber)
      return true
    } catch {
      return false
    }
  },

  unlinkIssue: async (repoId, prNumber, issueNumber) => {
    try {
      await api.unlinkPrFromIssue(repoId, prNumber, issueNumber)
      return true
    } catch {
      return false
    }
  },

  loadPulls: async (repoId) => {
    const version = ++_loadVersion
    try {
      const pulls = await api.listPulls(repoId, "all")
      if (_loadVersion !== version) return
      set({ pulls, loaded: true })
    } catch {
      if (_loadVersion !== version) return
      set({ loaded: true })
    }
  },

  syncPulls: async (repoId) => {
    const version = ++_loadVersion
    set({ syncing: true, syncError: null })
    try {
      await api.syncPulls(repoId, "open")
      const pulls = await api.listPulls(repoId, "all")
      if (_loadVersion !== version) return
      set({ pulls, syncing: false })
    } catch (err) {
      if (_loadVersion !== version) return
      let message = "同步 PR 失败"
      if (err instanceof ApiError) {
        try {
          const body = JSON.parse(err.message)
          if (body.error) message = body.error
        } catch {
          if (err.message) message = err.message
        }
      }
      set({ syncing: false, syncError: message })
    }
  },
}))

import { create } from "zustand"
import * as api from "../lib/api-client"
import type { Issue } from "../lib/api-client"
import { useRepoStore } from "./repo-store"

interface IssueState {
  issues: Issue[]
  loaded: boolean
  syncing: boolean
  selectedIssueId: string | null
  setSelectedIssue: (id: string | null) => void
  loadIssues: () => Promise<void>
  syncIssues: () => Promise<void>
  createIssue: (title: string, body?: string) => Promise<Issue | null>
}

export const useIssueStore = create<IssueState>((set) => ({
  issues: [],
  loaded: false,
  syncing: false,
  selectedIssueId: null,
  setSelectedIssue: (id) => set({ selectedIssueId: id }),

  loadIssues: async () => {
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) {
      set({ issues: [], loaded: true })
      return
    }
    try {
      const issues = await api.listIssues(repoId, "open")
      set({ issues, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  syncIssues: async () => {
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) return
    set({ syncing: true })
    try {
      await api.syncIssues(repoId)
      const issues = await api.listIssues(repoId, "open")
      set({ issues, syncing: false })
    } catch {
      set({ syncing: false })
    }
  },

  createIssue: async (title, body) => {
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) return null
    try {
      const issue = await api.createIssue(repoId, title, body)
      set((state) => ({ issues: [issue, ...state.issues] }))
      return issue
    } catch {
      return null
    }
  },
}))

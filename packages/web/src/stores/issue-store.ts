import { create } from "zustand"
import * as api from "../lib/api-client"
import type { Issue } from "../lib/api-client"
import { useRepoStore } from "./repo-store"

interface IssueState {
  issues: Issue[]
  loaded: boolean
  syncing: boolean
  selectedIssueId: string | null
  previewIssueId: string | null
  matchingParentId: string | null
  matchingCandidateId: string | null
  setSelectedIssue: (id: string | null) => void
  setPreviewIssue: (id: string | null) => void
  enterMatchMode: (parentId: string) => void
  exitMatchMode: () => void
  setMatchCandidate: (id: string | null) => void
  linkChild: (parentNumber: number, childNumber: number) => Promise<boolean>
  loadIssues: () => Promise<void>
  syncIssues: () => Promise<void>
  createIssue: (title: string, body?: string) => Promise<Issue | null>
}

export const useIssueStore = create<IssueState>((set, get) => ({
  issues: [],
  loaded: false,
  syncing: false,
  selectedIssueId: null,
  previewIssueId: null,
  matchingParentId: null,
  matchingCandidateId: null,
  setSelectedIssue: (id) => set({ selectedIssueId: id }),
  setPreviewIssue: (id) => set({ previewIssueId: id }),
  enterMatchMode: (parentId) => set({ matchingParentId: parentId, matchingCandidateId: null, previewIssueId: null }),
  exitMatchMode: () => {
    const parentId = get().matchingParentId
    set({ matchingParentId: null, matchingCandidateId: null, previewIssueId: parentId })
  },
  setMatchCandidate: (id) => set({ matchingCandidateId: id }),
  linkChild: async (parentNumber, childNumber) => {
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) return false
    try {
      await api.linkChildIssue(repoId, parentNumber, childNumber)
      const parentId = get().issues.find((i) => i.number === parentNumber)?.id
      if (parentId) {
        set((s) => ({
          issues: s.issues.map((i) => i.number === childNumber ? { ...i, parentId } : i),
          matchingCandidateId: null,
        }))
      }
      return true
    } catch {
      return false
    }
  },

  loadIssues: async () => {
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) {
      set({ issues: [], loaded: true })
      return
    }
    try {
      const issues = await api.listIssues(repoId, "all")
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
      const issues = await api.listIssues(repoId, "all")
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

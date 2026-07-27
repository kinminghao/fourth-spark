import { create } from "zustand"
import * as api from "../lib/api-client"
import type { Issue, Tag } from "../lib/api-client"
import { useRepoStore } from "./repo-store"

interface IssueState {
  issues: Issue[]
  tags: Tag[]
  selectedTagIds: Set<string>
  loaded: boolean
  syncing: boolean
  selectedIssueId: string | null
  previewIssueId: string | null
  matchingParentId: string | null
  matchingCandidateId: string | null
  clearIssues: () => void
  setSelectedIssue: (id: string | null) => void
  setPreviewIssue: (id: string | null) => void
  enterMatchMode: (parentId: string) => void
  exitMatchMode: () => void
  setMatchCandidate: (id: string | null) => void
  linkChild: (parentNumber: number, childNumber: number) => Promise<boolean>
  updateIssueState: (issueNumber: number, state: "open" | "closed") => Promise<boolean>
  loadIssues: () => Promise<void>
  syncIssues: () => Promise<void>
  createIssue: (title: string, body?: string) => Promise<Issue | null>
  loadTags: () => Promise<void>
  toggleTagFilter: (tagId: string) => void
  clearTagFilter: () => void
}

export const useIssueStore = create<IssueState>((set, get) => ({
  issues: [],
  tags: [],
  selectedTagIds: new Set<string>(),
  loaded: false,
  syncing: false,
  selectedIssueId: null,
  previewIssueId: null,
  matchingParentId: null,
  matchingCandidateId: null,
  clearIssues: () => set({
    issues: [],
    tags: [],
    selectedTagIds: new Set<string>(),
    loaded: false,
    selectedIssueId: null,
    previewIssueId: null,
    matchingParentId: null,
    matchingCandidateId: null,
  }),
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

  updateIssueState: async (issueNumber, state) => {
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) return false
    try {
      const updated = await api.updateIssue(repoId, issueNumber, { state })
      set((s) => ({
        issues: s.issues.map((i) => i.number === issueNumber ? { ...i, state: updated.state } : i),
      }))
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
      const [issues, tags] = await Promise.all([
        api.listIssues(repoId, "all"),
        api.listTags(repoId),
      ])
      set({ issues, tags, syncing: false })
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

  loadTags: async () => {
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) {
      set({ tags: [] })
      return
    }
    try {
      const tags = await api.listTags(repoId)
      set({ tags })
    } catch { /* noop */ }
  },

  toggleTagFilter: (tagId) => {
    set((s) => {
      const next = new Set(s.selectedTagIds)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return { selectedTagIds: next }
    })
  },

  clearTagFilter: () => set({ selectedTagIds: new Set<string>() }),
}))

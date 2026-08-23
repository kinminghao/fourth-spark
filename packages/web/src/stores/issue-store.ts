import { create } from "zustand"
import * as api from "../lib/api-client"
import { ApiError } from "../lib/api-client"
import type { Issue, Tag, Milestone } from "../lib/api-client"
import { useRepoStore } from "./repo-store"
import { useToastStore } from "./toast-store"

interface IssueState {
  issues: Issue[]
  tags: Tag[]
  tagFilterMode: Map<string, "include" | "exclude">
  milestones: Milestone[]
  selectedMilestoneId: string | null
  loaded: boolean
  syncing: boolean
  selectedIssueId: string | null
  matchingParentId: string | null
  matchingCandidateId: string | null
  clearIssues: () => void
  setSelectedIssue: (id: string | null) => void
  enterMatchMode: (parentId: string) => void
  exitMatchMode: () => void
  setMatchCandidate: (id: string | null) => void
  linkChild: (parentNumber: number, childNumber: number) => Promise<boolean>
  updateIssueState: (issueNumber: number, state: "open" | "closed") => Promise<boolean>
  loadIssues: () => Promise<void>
  syncIssues: () => Promise<void>
  createIssue: (title: string, body?: string) => Promise<Issue | null>
  loadTags: () => Promise<void>
  cycleTagFilter: (tagId: string) => void
  clearTagFilter: () => void
  loadMilestones: () => Promise<void>
  setMilestoneFilter: (id: string | null) => void
}

export const useIssueStore = create<IssueState>((set, get) => ({
  issues: [],
  tags: [],
  tagFilterMode: new Map<string, "include" | "exclude">(),
  milestones: [],
  selectedMilestoneId: null,
  loaded: false,
  syncing: false,
  selectedIssueId: null,
  matchingParentId: null,
  matchingCandidateId: null,
  clearIssues: () => set({
    issues: [],
    tags: [],
    tagFilterMode: new Map<string, "include" | "exclude">(),
    milestones: [],
    selectedMilestoneId: null,
    loaded: false,
    selectedIssueId: null,
    matchingParentId: null,
    matchingCandidateId: null,
  }),
  setSelectedIssue: (id) => set({ selectedIssueId: id }),
  enterMatchMode: (parentId) => set({ matchingParentId: parentId, matchingCandidateId: null }),
  exitMatchMode: () => {
    set({ matchingParentId: null, matchingCandidateId: null })
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
      await api.syncIssues(repoId, "open")
      const [issues, tags, milestones] = await Promise.all([
        api.listIssues(repoId, "all"),
        api.listTags(repoId),
        api.listMilestones(repoId),
      ])
      set({ issues, tags, milestones, syncing: false })
    } catch (err) {
      set({ syncing: false })
      let message = "同步 Issue 失败"
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

  cycleTagFilter: (tagId) => {
    set((s) => {
      const next = new Map(s.tagFilterMode)
      const current = next.get(tagId)
      if (!current) next.set(tagId, "include")
      else if (current === "include") next.set(tagId, "exclude")
      else next.delete(tagId)
      return { tagFilterMode: next }
    })
  },

  clearTagFilter: () => set({ tagFilterMode: new Map<string, "include" | "exclude">() }),

  loadMilestones: async () => {
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) {
      set({ milestones: [] })
      return
    }
    try {
      const milestones = await api.listMilestones(repoId)
      set({ milestones })
    } catch { /* noop */ }
  },

  setMilestoneFilter: (id) => set({ selectedMilestoneId: id }),
}))

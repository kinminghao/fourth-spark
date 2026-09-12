import { create } from "zustand"
import * as api from "../lib/api-client"
import { ApiError } from "../lib/api-client"
import type { Issue, Tag, Milestone } from "../lib/api-client"
import { ISSUES_LOAD_LIMIT } from "../lib/constants"

/** Monotonic version counter — incremented on every load/sync call so stale
 *  responses from a previous repo context are silently discarded. */
let _loadVersion = 0

interface IssueState {
  issues: Issue[]
  issueTotal: number
  tags: Tag[]
  tagFilterMode: Map<string, "include" | "exclude">
  milestones: Milestone[]
  selectedMilestoneId: string | null
  loaded: boolean
  syncing: boolean
  syncError: string | null
  selectedIssueId: string | null
  viewingIssueId: string | null
  viewingTreeRootId: string | null
  matchingParentId: string | null
  matchingCandidateId: string | null
  clearIssues: () => void
  setSelectedIssue: (id: string | null) => void
  setViewingIssue: (id: string | null, treeRootId?: string | null) => void
  enterMatchMode: (parentId: string) => void
  exitMatchMode: () => void
  linkChild: (repoId: string, parentNumber: number, childNumber: number) => Promise<boolean>
  updateIssueState: (repoId: string, issueNumber: number, state: "open" | "closed") => Promise<boolean>
  loadIssues: (repoId: string) => Promise<void>
  syncIssues: (repoId: string) => Promise<void>
  createIssue: (repoId: string, title: string, body?: string) => Promise<Issue | null>
  loadTags: (repoId: string) => Promise<void>
  cycleTagFilter: (tagId: string) => void
  clearTagFilter: () => void
  loadMilestones: (repoId: string) => Promise<void>
  setMilestoneFilter: (id: string | null) => void
}

export const useIssueStore = create<IssueState>((set, get) => ({
  issues: [],
  issueTotal: 0,
  tags: [],
  tagFilterMode: new Map<string, "include" | "exclude">(),
  milestones: [],
  selectedMilestoneId: null,
  loaded: false,
  syncing: false,
  syncError: null,
  selectedIssueId: null,
  viewingIssueId: null,
  viewingTreeRootId: null,
  matchingParentId: null,
  matchingCandidateId: null,
  clearIssues: () => {
    ++_loadVersion
    set({
      issues: [],
      issueTotal: 0,
      tags: [],
      tagFilterMode: new Map<string, "include" | "exclude">(),
      milestones: [],
      selectedMilestoneId: null,
      loaded: false,
      syncError: null,
      selectedIssueId: null,
      viewingIssueId: null,
      viewingTreeRootId: null,
      matchingParentId: null,
      matchingCandidateId: null,
    })
  },
  setSelectedIssue: (id) => set({ selectedIssueId: id }),
  setViewingIssue: (id, treeRootId) => set({ viewingIssueId: id, viewingTreeRootId: treeRootId ?? null }),
  enterMatchMode: (parentId) => set({ matchingParentId: parentId, matchingCandidateId: null }),
  exitMatchMode: () => {
    set({ matchingParentId: null, matchingCandidateId: null })
  },
  linkChild: async (repoId, parentNumber, childNumber) => {
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

  updateIssueState: async (repoId, issueNumber, state) => {
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

  loadIssues: async (repoId) => {
    const version = ++_loadVersion
    try {
      const result = await api.listIssues(repoId, "all", { limit: ISSUES_LOAD_LIMIT })
      if (_loadVersion !== version) return
      set({ issues: result.items, issueTotal: result.total, loaded: true })
    } catch {
      if (_loadVersion !== version) return
      set({ loaded: true })
    }
  },

  syncIssues: async (repoId) => {
    const version = ++_loadVersion
    set({ syncing: true, syncError: null })
    try {
      await api.syncIssues(repoId, "open")
      const [issueResult, tags, milestones] = await Promise.all([
        api.listIssues(repoId, "all", { limit: ISSUES_LOAD_LIMIT }),
        api.listTags(repoId),
        api.listMilestones(repoId),
      ])
      if (_loadVersion !== version) return
      set({ issues: issueResult.items, issueTotal: issueResult.total, tags, milestones, syncing: false })
    } catch (err) {
      if (_loadVersion !== version) return
      let message = "同步 Issue 失败"
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

  createIssue: async (repoId, title, body) => {
    try {
      const issue = await api.createIssue(repoId, title, body)
      set((state) => ({ issues: [issue, ...state.issues] }))
      return issue
    } catch {
      return null
    }
  },

  loadTags: async (repoId) => {
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

  loadMilestones: async (repoId) => {
    try {
      const milestones = await api.listMilestones(repoId)
      set({ milestones })
    } catch { /* noop */ }
  },

  setMilestoneFilter: (id) => set({ selectedMilestoneId: id }),
}))

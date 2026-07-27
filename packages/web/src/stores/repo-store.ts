import { create } from "zustand"
import * as api from "../lib/api-client"
import type { Repo } from "../lib/api-client"

const STORAGE_KEY = "fs-active-repo"

interface RepoState {
  repos: Repo[]
  activeRepoId: string | null
  loading: boolean
  loadError: string | null

  loadRepos: () => Promise<void>
  setActiveRepo: (id: string | null) => void
  addRepo: (name: string, gitUrl: string, localPath: string) => Promise<Repo | null>
  removeRepo: (id: string) => Promise<void>
  updateRepoBranch: (repoId: string, branch: string) => void
}

export const useRepoStore = create<RepoState>((set, get) => ({
  repos: [],
  activeRepoId: localStorage.getItem(STORAGE_KEY),
  loading: false,
  loadError: null,

  loadRepos: async () => {
    set({ loading: true, loadError: null })
    try {
      const repos = await api.listRepos()
      const activeRepoId = get().activeRepoId
      // If stored activeRepoId is no longer valid, clear it.
      const valid = activeRepoId && repos.some((r) => r.id === activeRepoId)
      set({
        repos,
        loading: false,
        activeRepoId: valid ? activeRepoId : repos.length > 0 ? repos[0].id : null,
      })
      // Persist.
      const finalId = get().activeRepoId
      if (finalId) localStorage.setItem(STORAGE_KEY, finalId)
      else localStorage.removeItem(STORAGE_KEY)
    } catch (error) {
      set({
        loading: false,
        loadError: error instanceof Error ? error.message : "Failed to load repos",
      })
    }
  },

  setActiveRepo: (id) => {
    set({ activeRepoId: id })
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  },

  addRepo: async (name, gitUrl, localPath) => {
    try {
      const repo = await api.createRepo(name, gitUrl, localPath)
      set((state) => ({
        repos: [...state.repos, repo],
        activeRepoId: repo.id,
      }))
      localStorage.setItem(STORAGE_KEY, repo.id)
      return repo
    } catch (error) {
      set({
        loadError: error instanceof Error ? error.message : "Failed to add repo",
      })
      return null
    }
  },

  removeRepo: async (id) => {
    try {
      await api.deleteRepo(id)
    } catch {
      // Best-effort.
    }
    set((state) => {
      const repos = state.repos.filter((r) => r.id !== id)
      const activeRepoId = state.activeRepoId === id
        ? (repos.length > 0 ? repos[0].id : null)
        : state.activeRepoId
      if (activeRepoId) localStorage.setItem(STORAGE_KEY, activeRepoId)
      else localStorage.removeItem(STORAGE_KEY)
      return { repos, activeRepoId }
    })
  },

  updateRepoBranch: (repoId, branch) => {
    set((state) => ({
      repos: state.repos.map((r) => (r.id === repoId ? { ...r, branch } : r)),
    }))
  },
}))

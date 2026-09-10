import { create } from "zustand"
import * as api from "../lib/api-client"
import type { CustomAgent } from "../lib/api-client"
import { useRepoStore } from "./repo-store"

interface CustomAgentState {
  agents: CustomAgent[]
  loaded: boolean
  loadAgents: () => Promise<void>
}

export const useCustomAgentStore = create<CustomAgentState>((set) => ({
  agents: [],
  loaded: false,

  loadAgents: async () => {
    const repoId = useRepoStore.getState().activeRepoId
    try {
      const agents = repoId
        ? await api.listRepoCustomAgents(repoId)
        : await api.listGlobalCustomAgents()
      if (useRepoStore.getState().activeRepoId !== repoId) return
      set({ agents, loaded: true })
    } catch {
      if (useRepoStore.getState().activeRepoId !== repoId) return
      set({ loaded: true })
    }
  },
}))

import { create } from "zustand"
import * as api from "../lib/api-client"
import type { CustomAgent } from "../lib/api-client"
import { useRepoStore } from "./repo-store"

interface CustomAgentState {
  agents: CustomAgent[]
  loaded: boolean
  loadAgents: () => Promise<void>
  createAgent: (data: { name: string; baseAgent: string; model?: string; systemPrompt?: string }, repoId?: string) => Promise<CustomAgent>
  updateAgent: (id: string, data: { name?: string; baseAgent?: string; model?: string | null; systemPrompt?: string }) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
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
      set({ agents, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  createAgent: async (data, repoId) => {
    const agent = repoId
      ? await api.createRepoCustomAgent(repoId, data)
      : await api.createGlobalCustomAgent(data)
    set((state) => ({ agents: [...state.agents, agent] }))
    return agent
  },

  updateAgent: async (id, data) => {
    const updated = await api.updateCustomAgent(id, data)
    set((state) => ({ agents: state.agents.map((a) => a.id === id ? updated : a) }))
  },

  deleteAgent: async (id) => {
    await api.deleteCustomAgent(id)
    set((state) => ({ agents: state.agents.filter((a) => a.id !== id) }))
  },
}))

import { create } from "zustand"
import * as api from "../lib/api-client"
import { ApiError } from "../lib/api-client"
import type { CustomAgent } from "../lib/api-client"
import { useRepoStore } from "./repo-store"
import { useToastStore } from "./toast-store"

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
    } catch (err) {
      if (useRepoStore.getState().activeRepoId !== repoId) return
      set({ loaded: true })
      let message = "加载 Agent 列表失败"
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

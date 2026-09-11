import { create } from "zustand"
import * as api from "../lib/api-client"
import { ApiError } from "../lib/api-client"
import type { CustomAgent } from "../lib/api-client"
import { notify } from "./notifications"

/** Monotonic version counter for stale-response discarding. */
let _loadVersion = 0

interface CustomAgentState {
  agents: CustomAgent[]
  loaded: boolean
  loadAgents: (repoId: string | null) => Promise<void>
}

export const useCustomAgentStore = create<CustomAgentState>((set) => ({
  agents: [],
  loaded: false,

  loadAgents: async (repoId) => {
    const version = ++_loadVersion
    try {
      const agents = repoId
        ? await api.listRepoCustomAgents(repoId)
        : await api.listGlobalCustomAgents()
      if (_loadVersion !== version) return
      set({ agents, loaded: true })
    } catch (err) {
      if (_loadVersion !== version) return
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
      notify(message, "error")
    }
  },
}))

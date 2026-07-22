/*
 * Small standalone store for the available agent list (used by the New Session
 * form). Agents are fetched per-repo since different repos may have different
 * agent configurations.
 */

import { create } from "zustand"
import * as api from "../lib/api-client"
import type { Agent } from "../lib/api-client"
import { useRepoStore } from "./repo-store"

interface AgentState {
  agents: Agent[]
  loaded: boolean
  loadAgents: () => Promise<void>
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  loaded: false,
  loadAgents: async () => {
    const repoId = useRepoStore.getState().activeRepoId
    if (!repoId) {
      set({ agents: [], loaded: true })
      return
    }
    try {
      const agents = await api.listAgents(repoId)
      set({ agents, loaded: true })
    } catch {
      // Agents are optional; without them the New Session form just omits the
      // dropdown and the backend picks its default agent.
      set({ loaded: true })
    }
  },
}))

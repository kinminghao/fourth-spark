/*
 * Small standalone store for the available agent list (used by the New Session
 * form). Kept separate from the session store since agents are static metadata,
 * not per-session state.
 */

import { create } from "zustand"
import * as api from "../lib/api-client"
import type { Agent } from "../lib/api-client"

interface AgentState {
  agents: Agent[]
  loaded: boolean
  loadAgents: () => Promise<void>
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  loaded: false,
  loadAgents: async () => {
    try {
      const agents = await api.listAgents()
      set({ agents, loaded: true })
    } catch {
      // Agents are optional; without them the New Session form just omits the
      // dropdown and the backend picks its default agent.
      set({ loaded: true })
    }
  },
}))

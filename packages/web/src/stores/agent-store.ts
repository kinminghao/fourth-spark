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

const ALLOWED_AGENTS = ["sisyphus", "prometheus", "atlas"]

function isAllowed(agent: Agent): boolean {
  const name = (agent.name || agent.id || "").toLowerCase()
  return ALLOWED_AGENTS.some((key) => name.startsWith(key))
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
      const all = await api.listAgents(repoId)
      set({ agents: all.filter(isAllowed), loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
}))

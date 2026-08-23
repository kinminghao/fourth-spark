/*
 * Small standalone store for the available agent list (used by the New Session
 * form). Agents are fetched per-repo since different repos may have different
 * agent configurations.
 */

/*
 * Small standalone store for the available agent list.
 *
 * NOTE: `loadAgents` was removed (dead code — never called by any component).
 * The store is still imported by session-store to read `.loaded` / `.agents`,
 * so the shell is kept.  A future PR should either re-wire loading or remove
 * the store entirely.
 */

import { create } from "zustand"
import type { Agent } from "../lib/api-client"

interface AgentState {
  agents: Agent[]
  loaded: boolean
}

export const useAgentStore = create<AgentState>(() => ({
  agents: [],
  loaded: false,
}))

import { create } from "zustand"

const NAV_KEY = "fs-nav-collapsed"
const SESSION_PANEL_KEY = "fs-session-panel-collapsed"

interface LayoutState {
  navCollapsed: boolean
  sessionPanelCollapsed: boolean
  toggleNav: () => void
  toggleSessionPanel: () => void
  setNavCollapsed: (collapsed: boolean) => void
  setSessionPanelCollapsed: (collapsed: boolean) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  navCollapsed: localStorage.getItem(NAV_KEY) === "true",
  sessionPanelCollapsed: localStorage.getItem(SESSION_PANEL_KEY) === "true",

  toggleNav() {
    set((state) => {
      const next = !state.navCollapsed
      localStorage.setItem(NAV_KEY, String(next))
      return { navCollapsed: next }
    })
  },

  toggleSessionPanel() {
    set((state) => {
      const next = !state.sessionPanelCollapsed
      localStorage.setItem(SESSION_PANEL_KEY, String(next))
      return { sessionPanelCollapsed: next }
    })
  },

  setNavCollapsed(collapsed: boolean) {
    localStorage.setItem(NAV_KEY, String(collapsed))
    set({ navCollapsed: collapsed })
  },

  setSessionPanelCollapsed(collapsed: boolean) {
    localStorage.setItem(SESSION_PANEL_KEY, String(collapsed))
    set({ sessionPanelCollapsed: collapsed })
  },
}))

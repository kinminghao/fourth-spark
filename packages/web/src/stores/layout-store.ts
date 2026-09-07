import { create } from "zustand"

const NAV_KEY = "fs-nav-collapsed"
const SESSION_PANEL_KEY = "fs-session-panel-collapsed"

interface LayoutState {
  navCollapsed: boolean
  sessionPanelCollapsed: boolean
  guideTourOpen: boolean
  toggleNav: () => void
  toggleSessionPanel: () => void
  startGuideTour: () => void
  stopGuideTour: () => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  navCollapsed: localStorage.getItem(NAV_KEY) === "true",
  sessionPanelCollapsed: localStorage.getItem(SESSION_PANEL_KEY) === "true",
  guideTourOpen: false,

  startGuideTour() {
    set({ guideTourOpen: true })
  },

  stopGuideTour() {
    set({ guideTourOpen: false })
  },

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
}))

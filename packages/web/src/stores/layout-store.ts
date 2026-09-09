import { create } from "zustand"
import type { GuideSection } from "../components/guide-steps"

const NAV_KEY = "fs-nav-collapsed"
const SESSION_PANEL_KEY = "fs-session-panel-collapsed"

interface LayoutState {
  navCollapsed: boolean
  sessionPanelCollapsed: boolean
  guideTourOpen: boolean
  guideTourSection: GuideSection | null
  toggleNav: () => void
  toggleSessionPanel: () => void
  startGuideTour: (section?: GuideSection | null) => void
  stopGuideTour: () => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  navCollapsed: localStorage.getItem(NAV_KEY) === "true",
  sessionPanelCollapsed: localStorage.getItem(SESSION_PANEL_KEY) === "true",
  guideTourOpen: false,
  guideTourSection: null,

  startGuideTour(section) {
    set({ guideTourOpen: true, guideTourSection: section ?? null })
  },

  stopGuideTour() {
    set({ guideTourOpen: false, guideTourSection: null })
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

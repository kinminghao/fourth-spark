import { create } from "zustand"

type Preference = "system" | "light" | "dark"
type Resolved = "light" | "dark"

const STORAGE_KEY = "fs-theme"

function getSystemTheme(): Resolved {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function resolve(preference: Preference): Resolved {
  return preference === "system" ? getSystemTheme() : preference
}

/**
 * When "system" → remove attribute so the CSS `@media (prefers-color-scheme)`
 * rule takes effect (no flash on reload).
 * When explicit → set `data-theme` to override the media query.
 */
function applyToDOM(preference: Preference) {
  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme")
  } else {
    document.documentElement.setAttribute("data-theme", preference)
  }
}

interface ThemeState {
  preference: Preference
  resolved: Resolved
  setPreference: (preference: Preference) => void
  cycle: () => void
  init: () => () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: (localStorage.getItem(STORAGE_KEY) as Preference) ?? "system",
  resolved: resolve(
    (localStorage.getItem(STORAGE_KEY) as Preference) ?? "system",
  ),

  setPreference(preference: Preference) {
    const resolved = resolve(preference)
    localStorage.setItem(STORAGE_KEY, preference)
    applyToDOM(preference)
    set({ preference, resolved })
  },

  cycle() {
    const order: Preference[] = ["system", "light", "dark"]
    const next = order[(order.indexOf(get().preference) + 1) % order.length]
    get().setPreference(next)
  },

  init() {
    applyToDOM(get().preference)
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => {
      const { preference } = get()
      if (preference === "system") {
        const resolved = getSystemTheme()
        set({ resolved })
      }
    }
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  },
}))

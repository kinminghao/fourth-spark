import { create } from "zustand"
import { ApiError, getAuthStatus, onAuthRequired } from "../lib/api-client"
import { clearAuthToken, getAuthToken, setAuthToken } from "../lib/config"

type AuthState = "checking" | "authenticated" | "unauthenticated"

interface AuthStoreState {
  state: AuthState
  checkAuth: () => Promise<void>
  setAuthenticated: () => void
  setUnauthenticated: () => void
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  state: "checking",

  checkAuth: async () => {
    extractTokenFromUrl()

    const token = getAuthToken()
    if (token) {
      try {
        await getAuthStatus()
        set({ state: "authenticated" })
        return
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearAuthToken()
          set({ state: "unauthenticated" })
          return
        }
      }
    }

    try {
      const status = await getAuthStatus()
      set({ state: status.authRequired ? "unauthenticated" : "authenticated" })
    } catch {
      set({ state: "authenticated" })
    }
  },

  setAuthenticated: () => set({ state: "authenticated" }),
  setUnauthenticated: () => set({ state: "unauthenticated" }),
}))

function extractTokenFromUrl(): void {
  const params = new URLSearchParams(window.location.search)
  const token = params.get("token")
  if (!token) return

  setAuthToken(token)
  params.delete("token")
  const search = params.toString()
  const newUrl = search ? `${window.location.pathname}?${search}` : window.location.pathname
  window.history.replaceState({}, "", newUrl)
}

onAuthRequired(() => {
  useAuthStore.getState().setUnauthenticated()
})

import { create } from "zustand"

interface DraftState {
  drafts: Record<string, string>
  setDraft: (sessionId: string, content: string) => void
  clearDraft: (sessionId: string) => void
}

export const useDraftStore = create<DraftState>((set) => ({
  drafts: {},
  setDraft: (sessionId, content) =>
    set((state) => {
      if (!content.trim()) {
        const { [sessionId]: _, ...rest } = state.drafts
        return { drafts: rest }
      }
      return { drafts: { ...state.drafts, [sessionId]: content } }
    }),
  clearDraft: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.drafts
      return { drafts: rest }
    }),
}))

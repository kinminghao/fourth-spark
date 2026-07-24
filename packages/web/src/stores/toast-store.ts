import { create } from "zustand"

export type ToastVariant = "info" | "success" | "warning" | "error"

export type Toast = {
  id: string
  message: string
  variant: ToastVariant
  sessionId?: string
}

interface ToastState {
  toasts: Toast[]
  addToast: (message: string, variant?: ToastVariant, sessionId?: string) => void
  removeToast: (id: string) => void
}

let seq = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message, variant = "info", sessionId?) => {
    const id = `toast-${++seq}-${Date.now()}`
    set((s) => ({ toasts: [...s.toasts, { id, message, variant, sessionId }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 4000)
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

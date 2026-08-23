import { create } from "zustand"

export type ToastVariant = "info" | "success" | "warning" | "error"

export type Toast = {
  id: string
  message: string
  variant: ToastVariant
  sessionId?: string
  persistent?: boolean
}

interface AddToastOpts {
  id?: string
  persistent?: boolean
}

interface ToastState {
  toasts: Toast[]
  addToast: (message: string, variant?: ToastVariant, sessionId?: string, opts?: AddToastOpts) => void
  removeToast: (id: string) => void
}

let seq = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message, variant = "info", sessionId?, opts?) => {
    const id = opts?.id ?? `toast-${++seq}-${Date.now()}`
    set((s) => {
      if (s.toasts.some((t) => t.id === id)) return s
      return { toasts: [...s.toasts, { id, message, variant, sessionId, persistent: opts?.persistent }] }
    })
    if (!opts?.persistent) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, 4000)
    }
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

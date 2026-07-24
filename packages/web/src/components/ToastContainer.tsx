import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useToastStore, type Toast, type ToastVariant } from "../stores/toast-store"
import { useSessionStore } from "../stores/session-store"

/** How long the exit animation runs before the node is unmounted (ms). */
const EXIT_MS = 300
/** Total lifetime of a toast in the store — mirrors toast-store's setTimeout. */
const DURATION_MS = 4000

type RenderToast = Toast & { exiting?: boolean }

type VariantConfig = {
  /** Text-presentation glyph shown inside the icon badge. */
  icon: string
  /** Badge tint + icon colour classes. */
  badge: string
  /** Progress-bar accent colour class. */
  bar: string
}

const variantConfig: Record<ToastVariant, VariantConfig> = {
  info: { icon: "ℹ", badge: "bg-fg/10 text-fg-2", bar: "bg-fg-4" },
  success: { icon: "✓", badge: "bg-emerald-500/10 text-emerald-500", bar: "bg-emerald-500" },
  warning: { icon: "⚠", badge: "bg-amber-500/10 text-amber-500", bar: "bg-amber-500" },
  error: { icon: "✕", badge: "bg-red-500/10 text-red-500", bar: "bg-red-500" },
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const navigate = useNavigate()

  const handleClick = (t: RenderToast) => {
    removeToast(t.id)
    if (t.sessionId) {
      void setActiveSession(t.sessionId)
      navigate("/run")
    }
  }

  // Local mirror so a toast can play its exit animation after the store drops it.
  const [rendered, setRendered] = useState<RenderToast[]>([])
  const exitTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  // Sync store → local: append newcomers, flag departures as `exiting`.
  useEffect(() => {
    const liveIds = new Set(toasts.map((t) => t.id))
    setRendered((prev) => {
      let next = prev.map((r) =>
        liveIds.has(r.id) || r.exiting ? r : { ...r, exiting: true },
      )
      for (const t of toasts) {
        if (!next.some((r) => r.id === t.id)) next = [...next, { ...t }]
      }
      return next
    })
  }, [toasts])

  // Schedule unmount once a toast has been flagged as exiting.
  useEffect(() => {
    const timers = exitTimers.current
    for (const r of rendered) {
      if (r.exiting && !timers.has(r.id)) {
        timers.set(
          r.id,
          setTimeout(() => {
            timers.delete(r.id)
            setRendered((cur) => cur.filter((x) => x.id !== r.id))
          }, EXIT_MS),
        )
      }
    }
  }, [rendered])

  // Clear any pending timers on unmount.
  useEffect(() => {
    const timers = exitTimers.current
    return () => timers.forEach(clearTimeout)
  }, [])

  if (rendered.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed top-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col"
      aria-live="polite"
      aria-atomic="false"
    >
      {rendered.map((t) => {
        const cfg = variantConfig[t.variant]
        return (
          <div
            key={t.id}
            className="grid w-full transition-[grid-template-rows] duration-300 ease-out"
            style={{ gridTemplateRows: t.exiting ? "0fr" : "1fr" }}
          >
            <div className="min-h-0 overflow-hidden">
              <div
                role="status"
                onClick={() => handleClick(t)}
                style={{
                  animation: `${t.exiting ? "toast-out" : "toast-in"} 0.3s ease-out forwards`,
                }}
                className="pointer-events-auto relative mb-2 flex cursor-pointer items-start gap-3 overflow-hidden rounded-xl border border-line bg-surface/80 px-3.5 py-3 shadow-lg shadow-black/5 backdrop-blur-md transition-colors hover:border-line-hard hover:bg-surface/90"
              >
                <span
                  aria-hidden
                  className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${cfg.badge}`}
                >
                  {cfg.icon}
                </span>
                <p className="min-w-0 flex-1 text-sm leading-snug break-words text-fg">
                  {t.message}
                </p>
                {t.persistent && !t.exiting && (
                  <button
                    type="button"
                    aria-label="关闭"
                    onClick={(e) => { e.stopPropagation(); removeToast(t.id) }}
                    className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-fg-4 transition-colors hover:bg-fg/10 hover:text-fg"
                  >
                    ✕
                  </button>
                )}
                {!t.exiting && !t.persistent && (
                  <span
                    aria-hidden
                    className={`absolute bottom-0 left-0 h-0.5 w-full origin-left ${cfg.bar}`}
                    style={{ animation: `toast-progress ${DURATION_MS}ms linear forwards` }}
                  />
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

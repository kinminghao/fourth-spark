import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate, useLocation } from "react-router-dom"
import { X } from "lucide-react"
import { useLayoutStore } from "../stores/layout-store"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { GUIDE_STEPS, type TooltipPosition } from "./guide-steps"
import { injectMockData, restoreMockData, selectMockIssue, selectMockPr } from "./guide-mock-data"

const HIGHLIGHT_PAD = 6
const TOOLTIP_GAP = 12
/** Extra delay when a step requires route navigation (page needs to render) */
const ROUTE_SETTLE_MS = 200
/** Delay for trigger click + dropdown animation */
const TRIGGER_SETTLE_MS = 80

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function getTargetRect(selector: string, padding: number): Rect | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    top: r.top - padding,
    left: r.left - padding,
    width: r.width + padding * 2,
    height: r.height + padding * 2,
  }
}

function clipPathWithHole(rect: Rect): string {
  const { top, left, width, height } = rect
  const r = left + width
  const b = top + height
  return `polygon(
    0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
    ${left}px ${top}px, ${left}px ${b}px, ${r}px ${b}px, ${r}px ${top}px, ${left}px ${top}px
  )`
}

function tooltipStyle(
  targetRect: Rect,
  position: TooltipPosition,
): React.CSSProperties {
  const style: React.CSSProperties = { position: "fixed" }
  const below = targetRect.top + targetRect.height + TOOLTIP_GAP

  if (position === "bottom") {
    style.top = below
    style.left = targetRect.left
  } else if (position === "bottom-right") {
    style.top = below
    style.left = targetRect.left + targetRect.width
    style.transform = "translateX(-100%)"
  }

  return style
}

/** Click an element by selector if it exists in the DOM */
function clickSelector(selector: string) {
  const el = document.querySelector(selector) as HTMLElement | null
  if (el) el.click()
}

const SETUP_FNS: Record<string, () => void> = {
  selectMockIssue,
  selectMockPr,
}

export function GuideTour() {
  const navigate = useNavigate()
  const location = useLocation()
  const open = useLayoutStore((s) => s.guideTourOpen)
  const stop = useLayoutStore((s) => s.stopGuideTour)
  const repoName = useRepoStore(selectActiveRepoName)
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const prevStepRef = useRef(-1)
  const activeMockRef = useRef<string | null>(null)

  const current = GUIDE_STEPS[step]
  const total = GUIDE_STEPS.length
  const isFirst = step === 0
  const isLast = step === total - 1

  const measure = useCallback(() => {
    if (!open || !current) return
    const pad = current.padding ?? HIGHLIGHT_PAD
    setRect(getTargetRect(current.target, pad))
  }, [open, current])

  /** Resolve per-repo route: "dev/issues" → "/:repoName/dev/issues" */
  const resolveRoute = useCallback((route: string) => {
    if (route.startsWith("/")) return route
    return repoName ? `/${encodeURIComponent(repoName)}/${route}` : `/${route}`
  }, [repoName])

  // Reset step when tour opens
  useEffect(() => {
    if (open) {
      setStep(0)
      prevStepRef.current = -1
    }
  }, [open])

  // --- Core step transition logic ---
  useEffect(() => {
    if (!open || !current) return
    const prev = prevStepRef.current
    const prevDef = prev >= 0 ? GUIDE_STEPS[prev] : null

    // 1. Cleanup: close any dropdown the previous step opened
    if (prevDef?.triggerClick && document.querySelector(prevDef.target)) {
      clickSelector(prevDef.triggerClick)
    }

    // 2. Mock data lifecycle
    const prevScope = prevDef?.mockScope ?? null
    const curScope = current.mockScope ?? null
    if (curScope && curScope !== prevScope) {
      injectMockData()
      activeMockRef.current = curScope
    } else if (!curScope && activeMockRef.current) {
      restoreMockData()
      activeMockRef.current = null
    }

    // 3. Navigate if the current step requires a different route
    const fullRoute = current.route ? resolveRoute(current.route) : null
    const needsNav = fullRoute && !location.pathname.startsWith(fullRoute)
    if (needsNav) navigate(fullRoute)

    // 4. After navigation settles, run setup, open dropdown, then measure
    const delay = needsNav ? ROUTE_SETTLE_MS : curScope && curScope !== prevScope ? TRIGGER_SETTLE_MS : 0
    const t1 = setTimeout(() => {
      // Run setup function (e.g. select a mock issue to show detail panel)
      if (current.setupFn && SETUP_FNS[current.setupFn]) {
        SETUP_FNS[current.setupFn]()
      }

      // Wait for setup-triggered renders, then trigger click + measure
      setTimeout(() => {
        if (current.triggerClick && !document.querySelector(current.target)) {
          clickSelector(current.triggerClick)
        }
        setTimeout(measure, TRIGGER_SETTLE_MS)
      }, current.setupFn ? ROUTE_SETTLE_MS : 0)
    }, delay)

    prevStepRef.current = step
    return () => clearTimeout(t1)
  }, [open, step, current, navigate, location.pathname, measure, resolveRoute])

  // Measure on mount and on resize/scroll
  useLayoutEffect(() => { measure() }, [measure])

  useEffect(() => {
    if (!open) return
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [open, measure])

  // Close the tour: cleanup current step's dropdown + restore mock data, then stop
  const stepRef = useRef(step)
  stepRef.current = step

  const closeTour = useCallback(() => {
    const def = GUIDE_STEPS[stepRef.current]
    if (def?.triggerClick && document.querySelector(def.target)) {
      clickSelector(def.triggerClick)
    }
    if (activeMockRef.current) {
      restoreMockData()
      activeMockRef.current = null
    }
    stop()
  }, [stop])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeTour() }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, closeTour])

  if (!open || !current || !rect) return null

  const prev = () => { if (!isFirst) setStep((s) => s - 1) }
  const next = () => { if (isLast) closeTour(); else setStep((s) => s + 1) }

  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      {/* Dark overlay with hole */}
      <div
        className="absolute inset-0 bg-black/60 transition-[clip-path] duration-200"
        style={{ clipPath: clipPathWithHole(rect) }}
        onClick={closeTour}
      />

      {/* Highlight border */}
      <div
        className="pointer-events-none absolute rounded-lg ring-2 ring-blue-500 ring-offset-2 ring-offset-transparent transition-all duration-200"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        }}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="fixed z-[10000] w-72 rounded-xl border border-line bg-surface p-4 shadow-2xl"
        style={tooltipStyle(rect, current.position)}
      >
        <button
          type="button"
          onClick={closeTour}
          className="absolute right-2 top-2 rounded-md p-1 text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3"
          aria-label="关闭引导"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <h3 className="pr-6 text-sm font-semibold text-fg">{current.title}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-fg-3">{current.description}</p>

        <div className="mt-4 flex items-center justify-between">
          <span className="font-mono text-[11px] tabular-nums text-fg-5">
            {step + 1} / {total}
          </span>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={prev}
                className="rounded-md px-3 py-1 text-xs text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
              >
                上一步
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500"
            >
              {isLast ? "完成" : "下一步"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

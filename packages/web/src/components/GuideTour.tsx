import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate, useLocation } from "react-router-dom"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { useLayoutStore } from "../stores/layout-store"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { GUIDE_STEPS, stepsForSection, type GuideStep, type TooltipPosition } from "./guide-steps"
import { injectMockData, restoreMockData, selectMockIssue, selectMockPr, selectMockSession, clearActiveSession, getMockAgentId } from "./guide-mock-data"

const HIGHLIGHT_PAD = 6
const TOOLTIP_GAP = 12
const ROUTE_SETTLE_MS = 200
const TRIGGER_SETTLE_MS = 80
const TOOLTIP_WIDTH = 288 // w-72 = 18rem
const VIEWPORT_MARGIN = 8
const MD_BREAKPOINT = 768

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
  if (r.width === 0 && r.height === 0) return null
  if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) return null
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
  const vw = window.innerWidth
  const vh = window.innerHeight
  const below = targetRect.top + targetRect.height + TOOLTIP_GAP
  const above = targetRect.top - TOOLTIP_GAP

  let left = position === "bottom-right"
    ? targetRect.left + targetRect.width - TOOLTIP_WIDTH
    : targetRect.left
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - TOOLTIP_WIDTH - VIEWPORT_MARGIN))
  style.left = left

  if (below + 160 < vh) {
    style.top = below
  } else {
    style.bottom = vh - above
  }

  return style
}

function clickSelector(selector: string) {
  const el = document.querySelector(selector) as HTMLElement | null
  if (el) el.click()
}

const SETUP_FNS: Record<string, () => void> = {
  selectMockIssue,
  selectMockPr,
  selectMockSession,
  clearActiveSession,
}

function isMobile(): boolean {
  return window.innerWidth < MD_BREAKPOINT
}

function SwipeHintArrow({ direction }: { direction: "left" | "right" }) {
  const Icon = direction === "left" ? ChevronLeft : ChevronRight
  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className={`flex items-center gap-1 rounded-full bg-blue-500/20 px-6 py-4 ${
          direction === "left" ? "fs-swipe-left" : "fs-swipe-right"
        }`}
      >
        <Icon className="h-8 w-8 text-blue-400" strokeWidth={2.5} />
        <Icon className="h-8 w-8 text-blue-400/60" strokeWidth={2.5} />
        <Icon className="h-8 w-8 text-blue-400/30" strokeWidth={2.5} />
      </div>
    </div>
  )
}

function SwipeTooltip({
  step: currentStep,
  stepIdx,
  total,
  isFirst,
  isLast,
  onPrev,
  onNext,
  onClose,
}: {
  step: GuideStep
  stepIdx: number
  total: number
  isFirst: boolean
  isLast: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-24 z-[10000] flex justify-center px-4">
      <div className="w-72 rounded-xl border border-line bg-surface p-4 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 rounded-md p-1 text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3"
          aria-label="关闭引导"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <h3 className="pr-6 text-sm font-semibold text-fg">{currentStep.title}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-fg-3">{currentStep.description}</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="font-mono text-[11px] tabular-nums text-fg-5">
            {stepIdx + 1} / {total}
          </span>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button type="button" onClick={onPrev} className="rounded-md px-3 py-1 text-xs text-fg-3 transition-colors hover:bg-elevated hover:text-fg">
                上一步
              </button>
            )}
            <button type="button" onClick={onNext} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500">
              {isLast ? "完成" : "下一步"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function GuideTour() {
  const navigate = useNavigate()
  const location = useLocation()
  const open = useLayoutStore((s) => s.guideTourOpen)
  const section = useLayoutStore((s) => s.guideTourSection)
  const stop = useLayoutStore((s) => s.stopGuideTour)
  const repoName = useRepoStore(selectActiveRepoName)
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const prevStepRef = useRef(-1)
  const activeMockRef = useRef<string | null>(null)
  const stepsRef = useRef<GuideStep[]>(GUIDE_STEPS)

  const steps = stepsRef.current
  const current = steps[step]
  const total = steps.length
  const isFirst = step === 0
  const isLast = step === total - 1

  const measure = useCallback(() => {
    if (!open || !current) return
    const pad = current.padding ?? HIGHLIGHT_PAD
    setRect(getTargetRect(current.target, pad))
  }, [open, current])

  const resolveRoute = useCallback((route: string) => {
    const resolved = route.replace("__MOCK_AGENT__", getMockAgentId())
    if (resolved.startsWith("/")) return resolved
    return repoName ? `/${encodeURIComponent(repoName)}/${resolved}` : `/${resolved}`
  }, [repoName])

  useEffect(() => {
    if (open) {
      stepsRef.current = stepsForSection(section)
      setStep(0)
      prevStepRef.current = -1
    }
  }, [open, section])

  useEffect(() => {
    if (!open || !current) return
    const prev = prevStepRef.current
    const prevDef = prev >= 0 ? steps[prev] : null

    if (prevDef?.triggerClick && document.querySelector(prevDef.target)) {
      clickSelector(prevDef.triggerClick)
    }

    const prevScope = prevDef?.mockScope ?? null
    const curScope = current.mockScope ?? null
    if (curScope && curScope !== prevScope) {
      injectMockData(curScope)
      activeMockRef.current = curScope
    } else if (!curScope && activeMockRef.current) {
      restoreMockData()
      activeMockRef.current = null
    }

    const fullRoute = current.route ? resolveRoute(current.route) : null
    const needsNav = fullRoute && !location.pathname.startsWith(fullRoute)
    if (needsNav) navigate(fullRoute)

    const delay = needsNav ? ROUTE_SETTLE_MS : curScope && curScope !== prevScope ? TRIGGER_SETTLE_MS : 0
    const t1 = setTimeout(() => {
      if (current.setupFn && SETUP_FNS[current.setupFn]) {
        SETUP_FNS[current.setupFn]()
      }

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

  const stepRef = useRef(step)
  stepRef.current = step

  const closeTour = useCallback(() => {
    const def = stepsRef.current[stepRef.current]
    if (def?.triggerClick && document.querySelector(def.target)) {
      clickSelector(def.triggerClick)
    }
    if (activeMockRef.current) {
      restoreMockData()
      activeMockRef.current = null
    }
    stop()
  }, [stop])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeTour() }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, closeTour])

  if (!open || !current) return null

  const showSwipeHint = isMobile() && current.mobileSwipeHint && !rect
  if (!rect && !showSwipeHint) return null

  const prev = () => { if (!isFirst) setStep((s) => s - 1) }
  const next = () => { if (isLast) closeTour(); else setStep((s) => s + 1) }

  if (showSwipeHint) {
    return createPortal(
      <>
        <div className="fixed inset-0 z-[9998] bg-black/60" onClick={closeTour} />
        <SwipeHintArrow direction={current.mobileSwipeHint!} />
        <SwipeTooltip
          step={current}
          stepIdx={step}
          total={total}
          isFirst={isFirst}
          isLast={isLast}
          onPrev={prev}
          onNext={next}
          onClose={closeTour}
        />
      </>,
      document.body,
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      <div
        className="absolute inset-0 bg-black/60 transition-[clip-path] duration-200"
        style={{ clipPath: clipPathWithHole(rect!) }}
        onClick={closeTour}
      />

      <div
        className="pointer-events-none absolute rounded-lg ring-2 ring-blue-500 ring-offset-2 ring-offset-transparent transition-all duration-200"
        style={{
          top: rect!.top,
          left: rect!.left,
          width: rect!.width,
          height: rect!.height,
        }}
      />

      <div
        ref={tooltipRef}
        className="fixed z-[10000] w-72 rounded-xl border border-line bg-surface p-4 shadow-2xl"
        style={tooltipStyle(rect!, current.position)}
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

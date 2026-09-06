import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { useLayoutStore } from "../stores/layout-store"
import { GUIDE_STEPS, type TooltipPosition } from "./guide-steps"

const HIGHLIGHT_PAD = 6
const TOOLTIP_GAP = 12

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
  // Outer rectangle (full viewport) with an inner rectangular hole
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

export function GuideTour() {
  const open = useLayoutStore((s) => s.guideTourOpen)
  const stop = useLayoutStore((s) => s.stopGuideTour)
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const current = GUIDE_STEPS[step]
  const total = GUIDE_STEPS.length
  const isFirst = step === 0
  const isLast = step === total - 1

  const measure = useCallback(() => {
    if (!open || !current) return
    const pad = current.padding ?? HIGHLIGHT_PAD
    setRect(getTargetRect(current.target, pad))
  }, [open, current])

  // Reset step when tour opens
  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  // Measure on step change and on resize/scroll
  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    if (!open) return
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [open, measure])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, stop])

  // Step 2 needs the RepoSwitcher dropdown to be open so "管理仓库" is visible.
  // Open it when entering step 1 (0-indexed), close on leave.
  useEffect(() => {
    if (!open) return
    if (step === 1) {
      // Click the repo switcher to open the dropdown
      const trigger = document.querySelector('[data-guide="repo-switcher"]') as HTMLElement | null
      if (trigger) {
        // Only click if dropdown is not already open
        const dropdown = document.querySelector('[data-guide="manage-repos"]')
        if (!dropdown) trigger.click()
      }
    }
    // Re-measure after dropdown animation
    const timer = setTimeout(measure, 100)
    return () => clearTimeout(timer)
  }, [open, step, measure])

  if (!open || !current || !rect) return null

  const prev = () => {
    if (!isFirst) {
      // If leaving step 1, close the dropdown
      if (step === 1) {
        const trigger = document.querySelector('[data-guide="repo-switcher"]') as HTMLElement | null
        const dropdown = document.querySelector('[data-guide="manage-repos"]')
        if (trigger && dropdown) trigger.click()
      }
      setStep((s) => s - 1)
    }
  }

  const next = () => {
    if (isLast) {
      stop()
    } else {
      setStep((s) => s + 1)
    }
  }

  const close = () => {
    // Close dropdown if open
    if (step === 1) {
      const trigger = document.querySelector('[data-guide="repo-switcher"]') as HTMLElement | null
      const dropdown = document.querySelector('[data-guide="manage-repos"]')
      if (trigger && dropdown) trigger.click()
    }
    stop()
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      {/* Dark overlay with hole */}
      <div
        className="absolute inset-0 bg-black/60 transition-[clip-path] duration-200"
        style={{ clipPath: clipPathWithHole(rect) }}
        onClick={close}
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
        {/* Close button */}
        <button
          type="button"
          onClick={close}
          className="absolute right-2 top-2 rounded-md p-1 text-fg-5 transition-colors hover:bg-elevated hover:text-fg-3"
          aria-label="关闭引导"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {/* Content */}
        <h3 className="pr-6 text-sm font-semibold text-fg">{current.title}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-fg-3">{current.description}</p>

        {/* Footer: step counter + nav */}
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

import { useCallback, useRef } from "react"

interface UseSwipeDrawerOptions {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  /** Minimum horizontal distance to trigger (px). Default 40 */
  threshold?: number
  /** Disable the hook entirely (e.g. when a drawer is already open). */
  disabled?: boolean
}

interface TouchState {
  x0: number
  y0: number
  dir: "h" | "v" | null
  on: boolean
}

/** Pixels of movement before we lock direction */
const DIR_LOCK_PX = 8

/**
 * Detects left/right swipe gestures from any starting position.
 *
 * - Discriminates horizontal vs vertical to avoid fighting page scroll.
 * - Designed for mobile — callers should gate on viewport width if needed.
 */
export function useSwipeDrawer({
  onSwipeLeft,
  onSwipeRight,
  threshold = 40,
  disabled = false,
}: UseSwipeDrawerOptions = {}) {
  const touch = useRef<TouchState>({ x0: 0, y0: 0, dir: null, on: false })
  const dxRef = useRef(0)

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return
      const t = e.touches[0]
      touch.current = { x0: t.clientX, y0: t.clientY, dir: null, on: true }
      dxRef.current = 0
    },
    [disabled],
  )

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const c = touch.current
      if (!c.on) return
      const dx = e.touches[0].clientX - c.x0
      const dy = e.touches[0].clientY - c.y0
      if (!c.dir) {
        if (Math.abs(dx) > DIR_LOCK_PX || Math.abs(dy) > DIR_LOCK_PX) {
          c.dir = Math.abs(dx) > Math.abs(dy) ? "h" : "v"
        }
        return
      }
      if (c.dir === "v") {
        c.on = false
        return
      }
      dxRef.current = dx
    },
    [],
  )

  const onTouchEnd = useCallback(() => {
    const c = touch.current
    if (!c.on || c.dir !== "h") {
      c.on = false
      return
    }
    c.on = false
    const dx = dxRef.current
    if (dx > threshold) {
      onSwipeRight?.()
    } else if (dx < -threshold) {
      onSwipeLeft?.()
    }
  }, [threshold, onSwipeLeft, onSwipeRight])

  return { onTouchStart, onTouchMove, onTouchEnd }
}

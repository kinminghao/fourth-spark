import type { ReactNode } from "react"
import clsx from "clsx"

interface SwipeDrawerProps {
  /** Which side the drawer slides in from */
  side: "left" | "right"
  /** Whether the drawer is currently open */
  open: boolean
  /** Called when the user taps the backdrop or otherwise requests close */
  onClose: () => void
  /** Drawer content */
  children: ReactNode
  /** Tailwind width class for the drawer panel. Default "w-80" */
  width?: string
}

/**
 * Mobile-only slide-in drawer with backdrop.
 *
 * - Uses CSS `transform: translateX` for 60 fps animation.
 * - Respects safe-area insets via `--safe-top` / `--safe-bottom`.
 * - Hidden above `md` breakpoint — desktop layout handles sidebars natively.
 */
export function SwipeDrawer({ side, open, onClose, children, width = "w-80" }: SwipeDrawerProps) {
  const isLeft = side === "left"

  return (
    <div className="md:hidden">
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      <div
        className={clsx(
          "fixed top-0 bottom-0 z-50 flex flex-col bg-surface pt-[var(--safe-top)] pb-[var(--safe-bottom)] shadow-xl transition-transform duration-200 ease-out",
          width,
          isLeft ? "left-0 border-r border-line" : "right-0 border-l border-line",
          open
            ? "translate-x-0"
            : isLeft
              ? "-translate-x-full"
              : "translate-x-full",
        )}
      >
        {children}
      </div>
    </div>
  )
}

import { useState, type MouseEvent, type ReactNode } from "react"
import { Check, Trash2, X } from "lucide-react"
import clsx from "clsx"

interface InlineConfirmProps {
  /** Called when the user confirms the action */
  onConfirm: () => void
  /** Icon size: "sm" = h-3.5 w-3.5 p-1, "md" = h-4 w-4 p-1.5 */
  size?: "sm" | "md"
  /** "ghost" = no border (default), "outlined" = with border */
  variant?: "ghost" | "outlined"
  /** Color/opacity classes for the trigger button. Default: "text-fg-5 hover:text-red-400" */
  triggerClassName?: string
  /** Prevent click event propagation (for use inside clickable containers) */
  stopPropagation?: boolean
  /** Title for the trigger button */
  title?: string
  /** Sibling elements shown alongside trigger when not confirming, hidden when confirming */
  children?: ReactNode
}

/**
 * Inline confirm-before-action control.
 *
 * Shows a trigger button (Trash2 icon by default). On click, swaps to
 * confirm (Check) + cancel (X) buttons. Manages its own confirming state.
 *
 * Pass `children` for sibling buttons (e.g. Edit) that should be visible
 * only when not confirming.
 */
export function InlineConfirm({
  onConfirm,
  size = "sm",
  variant = "ghost",
  triggerClassName,
  stopPropagation,
  title = "删除",
  children,
}: InlineConfirmProps) {
  const [confirming, setConfirming] = useState(false)

  const iconClass = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"
  const padClass = size === "sm" ? "p-1" : "p-1.5"
  const roundClass = variant === "outlined" ? "rounded-md" : "rounded"
  const gap = size === "sm" ? "gap-0.5" : "gap-1"

  const handleStop = stopPropagation
    ? (e: MouseEvent) => e.stopPropagation()
    : undefined

  if (confirming) {
    return (
      <div className={clsx("flex items-center", gap)} onClick={handleStop}>
        <button
          type="button"
          onClick={() => { onConfirm(); setConfirming(false) }}
          className={clsx(
            roundClass, padClass,
            "text-red-400 hover:bg-red-500/10",
            variant === "outlined" && "border border-red-500/30",
          )}
        >
          <Check className={iconClass} />
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className={clsx(
            roundClass, padClass,
            "text-fg-4 hover:bg-elevated",
            variant === "outlined" && "border border-line",
          )}
        >
          <X className={iconClass} />
        </button>
      </div>
    )
  }

  return (
    <>
      {children}
      <button
        type="button"
        onClick={(e) => { handleStop?.(e); setConfirming(true) }}
        title={title}
        className={clsx(
          roundClass, padClass,
          triggerClassName ?? "text-fg-5 hover:text-red-400",
          variant === "outlined" && "border border-line transition-colors hover:border-red-500/30",
        )}
      >
        <Trash2 className={iconClass} />
      </button>
    </>
  )
}

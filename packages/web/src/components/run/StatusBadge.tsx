import clsx from "clsx"
import { STATUS_META } from "./run-view-utils"

export function StatusBadge({ status, reason }: { status: string | undefined; reason?: string }) {
  const meta = STATUS_META[status ?? "idle"] ?? STATUS_META.idle
  return (
    <span
      className={clsx(
        "flex items-center gap-1.5 rounded border border-line px-2 py-0.5 font-mono text-xs",
        meta.color,
      )}
      title={status === "error" && reason ? reason : undefined}
    >
      <span className={clsx("leading-none", meta.spin && "fs-spin")}>
        {meta.glyph}
      </span>
      <span>{meta.label}</span>
    </span>
  )
}

import { ChevronLeft, ChevronRight } from "lucide-react"
import clsx from "clsx"
import { PAGE_SIZE } from "../lib/constants"

interface PaginationProps {
  total: number
  page: number
  pageSize?: number
  onPageChange: (page: number) => void
}

export { PAGE_SIZE }

export function Pagination({ total, page, pageSize = PAGE_SIZE, onPageChange }: PaginationProps) {
  const safePageSize = Math.max(1, pageSize)
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  if (totalPages <= 1) return null

  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, total)

  return (
    <div className="flex items-center justify-between border-t border-line px-3 py-2">
      <span className="font-mono text-[11px] text-fg-5">
        {start}–{end} / {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
          className={clsx(
            "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
            page <= 0
              ? "text-fg-6 cursor-not-allowed"
              : "text-fg-4 hover:bg-elevated hover:text-fg-2",
          )}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[3rem] text-center font-mono text-xs text-fg-3">
          {page + 1} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          className={clsx(
            "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
            page >= totalPages - 1
              ? "text-fg-6 cursor-not-allowed"
              : "text-fg-4 hover:bg-elevated hover:text-fg-2",
          )}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback, useRef } from "react"
import { useToastStore } from "../stores/toast-store"
import { ApiError } from "../lib/api-client"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAsyncDataOptions<T> {
  /** Initial data value before first fetch completes */
  initialData?: T
  /** Show toast on error. Default: true */
  showErrorToast?: boolean
  /** Fallback error message when none can be parsed from the error */
  errorMessage?: string
  /** Skip fetching entirely (useful for conditional loading). Default: false */
  skip?: boolean
}

export interface AsyncDataResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** Re-run the fetcher. Safe to call from event handlers. */
  reload: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable message from an API error.
 * Mirrors the pattern used in issue-store / pr-store for consistency.
 */
function parseError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    try {
      const body = JSON.parse(err.message)
      if (body.error) return body.error
    } catch {
      if (err.message) return err.message
    }
  }
  if (err instanceof Error) return err.message
  return fallback
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Standardised async data fetching hook.
 *
 * Manages loading / error / data tri-state with:
 * - Automatic cancellation when deps change or component unmounts
 * - Optional error toast (enabled by default)
 * - `reload()` for manual re-fetching
 * - `skip` option for conditional fetching
 *
 * @param fetcher  Async function that returns the data. Called on mount and
 *                 whenever `deps` change (unless `skip` is true).
 * @param deps     Dependency array — the fetcher is re-invoked when any value
 *                 changes (same semantics as useEffect deps).
 * @param options  See {@link UseAsyncDataOptions}.
 */
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
  options?: UseAsyncDataOptions<T>,
): AsyncDataResult<T> {
  const {
    initialData,
    showErrorToast = true,
    errorMessage = "加载失败",
    skip = false,
  } = options ?? {}

  const [data, setData] = useState<T | null>(initialData ?? null)
  const [loading, setLoading] = useState(!skip)
  const [error, setError] = useState<string | null>(null)

  // Monotonic version counter — incremented on every fetch so stale
  // responses from a previous invocation are silently discarded.
  const versionRef = useRef(0)

  // Keep the latest fetcher/options accessible via refs so `execute`
  // has a stable identity and never depends on caller-provided deps.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const errorMessageRef = useRef(errorMessage)
  errorMessageRef.current = errorMessage
  const showErrorToastRef = useRef(showErrorToast)
  showErrorToastRef.current = showErrorToast

  const execute = useCallback(async () => {
    const version = ++versionRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await fetcherRef.current()
      if (versionRef.current !== version) return
      setData(result)
    } catch (err) {
      if (versionRef.current !== version) return
      const msg = parseError(err, errorMessageRef.current)
      setError(msg)
      if (showErrorToastRef.current) {
        useToastStore.getState().addToast(msg, "error")
      }
    }
    if (versionRef.current === version) {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (skip) {
      setLoading(false)
      return
    }
    void execute()
    return () => {
      // Bump version so any in-flight response is discarded.
      versionRef.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, skip])

  return { data, loading, error, reload: execute }
}

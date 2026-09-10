/**
 * Shared pagination utilities for list endpoints.
 *
 * Default limit = 50, max limit = 1000, offset ≥ 0.
 */

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 1000

export interface PaginationParams {
  limit: number
  offset: number
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

/**
 * Parse `limit` and `offset` query parameters with clamping.
 *
 * - `limit`  defaults to {@link DEFAULT_LIMIT}, clamped to [1, {@link MAX_LIMIT}].
 * - `offset` defaults to 0, clamped to ≥ 0.
 */
export function parsePagination(query: {
  limit?: string
  offset?: string
}): PaginationParams {
  let limit = Number(query.limit)
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT
  limit = Math.min(limit, MAX_LIMIT)

  let offset = Number(query.offset)
  if (!Number.isFinite(offset) || offset < 0) offset = 0

  return { limit, offset }
}

/** Build a {@link PaginatedResponse} from a full items array + total count. */
export function paginatedResponse<T>(
  items: T[],
  total: number,
  params: PaginationParams,
): PaginatedResponse<T> {
  return { items, total, limit: params.limit, offset: params.offset }
}

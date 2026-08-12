// `page` and `size` in, one page of an already-read list out. BUILD_SPEC section 5.9.
//
// Pure, and its own file, because every rule here is one a client will discover the hard way
// if it is wrong: a `size` of 0 that returns nothing forever, a `page` of -1 that slices from
// the end of the array, a `total` that reports the page rather than the collection. None of
// those throw, so none of them would be caught by anything except a test.
//
// The list arrives already paginated to completion by the DAL (BUILD_SPEC 3.1), so this
// slices an array in memory rather than passing an offset to Airtable. That is not a
// shortcut: Airtable's own paging is cursor-based with no random access, so a client asking
// for page 7 could not be served from it without walking the first six anyway.

/** Per section 5.9. A client asking for more gets `MAX_SIZE`, not an error. */
export const DEFAULT_SIZE = 25
export const MAX_SIZE = 100

export type Page<T> = {
  readonly data: readonly T[]
  readonly page: number
  readonly size: number
  /** Rows in the whole collection, NOT in `data`. What a client needs to count pages. */
  readonly total: number
}

/**
 * `page` is 1-based, matching every REST API a client will have used before this one.
 *
 * Both parameters are CLAMPED rather than rejected. A 400 on `size=1000` teaches a client
 * nothing it could not learn from receiving 100 rows and a `size` of 100 in the response,
 * and clamping means a paging loop that guesses wrong still terminates.
 */
export function paginate<T>(
  rows: readonly T[],
  raw: { page?: string | null; size?: string | null },
): Page<T> {
  const size = clamp(numberOr(raw.size, DEFAULT_SIZE), 1, MAX_SIZE)
  const page = Math.max(1, numberOr(raw.page, 1))
  const start = (page - 1) * size

  return {
    // A page past the end is an empty array, not a 404. "There is nothing here" is the
    // honest answer to a client walking until it runs out, which is how paging loops end.
    data: rows.slice(start, start + size),
    page,
    size,
    total: rows.length,
  }
}

/**
 * A finite integer, or the fallback.
 *
 * `Number('')` is 0 and `Number(null)` is 0, so both would silently become a page size of
 * zero without this: an absent parameter has to reach the default, not the clamp floor.
 */
function numberOr(raw: string | null | undefined, fallback: number): number {
  if (raw === undefined || raw === null || raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? Math.trunc(value) : fallback
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

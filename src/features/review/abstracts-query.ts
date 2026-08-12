// The Abstracts view's query state, encoded in the URL.
//
// It lives in `searchParams` rather than in React state, and that is the load-bearing
// decision on this surface. The DataTable primitive is fully controlled and says so in
// its own header: "Nothing here fetches, sorts, or filters, because on a table this wide
// the server is the only place those can happen without shipping the whole set to the
// browser." So the server does them, which means the query has to survive a request, and
// the URL is the only place it can live. It also makes a filtered view shareable, which
// is what an organizer actually does with one.
//
// Parsing is total. Every malformed value falls back to a default rather than throwing,
// because these strings come from whatever is in the address bar.

import {
  type DataTableFilter,
  type DataTableSort,
  DEFAULT_PAGE_SIZE,
  FILTER_OPERATORS,
  type FilterOperator,
  PAGE_SIZE_OPTIONS,
} from '@/components/primitives/data-table-types'
import { SORTABLE_ROW_KEYS } from '@/features/review/abstracts-accessors'
import { type AbstractQuery, ALL_TAB_ID } from '@/features/review/abstracts-filter'

export const QUERY_KEYS = {
  tab: 'tab',
  search: 'q',
  sort: 'sort',
  filter: 'f',
  track: 'track',
  page: 'page',
  size: 'size',
} as const

/** `~` because a filter value routinely contains a dot, a dash, and a colon. */
const PART = '~'

export type AbstractsQueryState = AbstractQuery & {
  readonly page: number
  readonly pageSize: number
}

/**
 * A key this surface can actually order or filter by, which is a question about the
 * ACCESSORS and not about the schema.
 *
 * It asked the field registry for `column === true`, meaning "there is a real Submissions
 * column behind this". That is a fact about Airtable and it has no say here: sorting and
 * filtering both happen in code, over rows already loaded, so the only thing that decides is
 * whether `rowText` or `rowNumber` can answer for the key.
 *
 * The Ratings column is the case that made the difference visible, and it failed silently in
 * the worst way. It is derived from `Reviews` and has no Submissions column, so the registry
 * said `column: false`, `parseSort` returned null for `?sort=ratings~asc`, and the header
 * wrote a sort into the URL that nothing ever read: rows never reordered and the arrow never
 * toggled. Ranking by score is the single thing a chair most wants from this table.
 *
 * `SORTABLE_ROW_KEYS` is the same set the Sort and Filter panes offer, so what the picker
 * lists and what the URL accepts cannot drift apart again.
 */
function isQueryableKey(key: string): boolean {
  return SORTABLE_ROW_KEYS.has(key)
}

function parseSort(raw: string | undefined): DataTableSort | null {
  if (raw === undefined) return null
  const parts = raw.split(PART)
  const key = parts.at(0) ?? ''
  if (!isQueryableKey(key)) return null
  return { key, direction: parts.at(1) === 'desc' ? 'desc' : 'asc' }
}

function parseFilter(raw: string, index: number): readonly DataTableFilter[] {
  const parts = raw.split(PART)
  const key = parts.at(0) ?? ''
  const operator = parts.at(1) ?? ''
  const rest = parts.slice(2)
  if (!isQueryableKey(key)) return []
  if (!FILTER_OPERATORS.includes(operator as FilterOperator)) return []
  return [
    // The id is positional. Nothing persists it, and the drawer only needs it to be
    // stable within one render pass.
    { id: `f${index}`, key, operator: operator as FilterOperator, value: rest.join(PART) },
  ]
}

function parseCount(
  raw: string | undefined,
  fallback: number,
  allowed?: readonly number[],
): number {
  const parsed = Number(raw ?? '')
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  if (allowed !== undefined && !allowed.includes(parsed)) return fallback
  return parsed
}

/**
 * Takes the plain object Next hands a page rather than a `URLSearchParams`, because that
 * is what `searchParams` resolves to and converting first would lose repeated keys.
 */
export type RawSearchParams = Record<string, string | readonly string[] | undefined>

// `typeof value === 'string'` rather than `Array.isArray`, which does not narrow a
// `readonly string[]` and hands back `any[]`.
function first(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : value.at(0)
}

function all(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return []
  return typeof value === 'string' ? [value] : value
}

export function parseAbstractsQuery(params: RawSearchParams): AbstractsQueryState {
  const source = new Map(Object.entries(params))
  const get = (key: string) => first(source.get(key))

  return {
    tabId: get(QUERY_KEYS.tab) ?? ALL_TAB_ID,
    search: get(QUERY_KEYS.search) ?? '',
    sort: parseSort(get(QUERY_KEYS.sort)),
    filters: all(source.get(QUERY_KEYS.filter)).flatMap(parseFilter),
    trackId: get(QUERY_KEYS.track),
    page: parseCount(get(QUERY_KEYS.page), 1),
    pageSize: parseCount(get(QUERY_KEYS.size), DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS),
  }
}

/**
 * Whether the address bar carries any table state of its own.
 *
 * The Saved Views default needs this. `buildAbstractsSearch` omits every key that is at its
 * default, so a URL with none of them is a pristine visit and is exactly when the default
 * view should be applied. Asking instead whether the PARSED query is empty would re-apply
 * the default over an organizer who had just cleared their filters by hand, because both
 * states parse identically.
 */
export function hasQueryState(params: RawSearchParams): boolean {
  const source = new Map(Object.entries(params))
  return Object.values(QUERY_KEYS).some((key) => {
    const value = source.get(key)
    // An empty array counts as absent. Next never produces one for a missing key, but a
    // caller building params by hand can, and "the key exists with no values in it" is not
    // state an organizer expressed.
    if (value === undefined) return false
    return typeof value === 'string' || value.length > 0
  })
}

export type QueryPatch = {
  readonly tabId?: string
  readonly search?: string
  readonly sort?: DataTableSort | null
  readonly filters?: readonly DataTableFilter[]
  readonly trackId?: string
  readonly page?: number
  readonly pageSize?: number
}

/**
 * Serialize a patched query back to a search string.
 *
 * Anything that changes the result set resets the page to 1 unless the patch names a
 * page explicitly. Without that, changing a filter can land you on page 4 of a two-page
 * list and the table looks empty for no visible reason (the same rule
 * `use-data-table-state.ts` applies to its own local state).
 */
export function buildAbstractsSearch(current: AbstractsQueryState, patch: QueryPatch): string {
  const next: AbstractsQueryState = { ...current, ...patch }
  const params = new URLSearchParams()

  if (next.tabId !== ALL_TAB_ID) params.set(QUERY_KEYS.tab, next.tabId)
  if (next.search.length > 0) params.set(QUERY_KEYS.search, next.search)
  if (next.sort !== null) {
    params.set(QUERY_KEYS.sort, `${next.sort.key}${PART}${next.sort.direction}`)
  }
  for (const filter of next.filters) {
    params.append(QUERY_KEYS.filter, `${filter.key}${PART}${filter.operator}${PART}${filter.value}`)
  }
  if (next.trackId !== undefined && next.trackId.length > 0) {
    params.set(QUERY_KEYS.track, next.trackId)
  }

  const resets = patch.page === undefined && changesResultSet(patch)
  const page = resets ? 1 : next.page
  if (page > 1) params.set(QUERY_KEYS.page, String(page))
  if (next.pageSize !== DEFAULT_PAGE_SIZE) params.set(QUERY_KEYS.size, String(next.pageSize))

  const query = params.toString()
  return query.length === 0 ? '' : `?${query}`
}

function changesResultSet(patch: QueryPatch): boolean {
  return (
    patch.tabId !== undefined ||
    patch.search !== undefined ||
    patch.filters !== undefined ||
    patch.trackId !== undefined ||
    patch.pageSize !== undefined
  )
}

// The CRM directory's query state, encoded in the URL.
//
// Same decision as `features/review/abstracts-query.ts`, and for the same reason: the
// DataTable primitive is fully controlled and does no filtering of its own, so the server
// does it, so the query has to survive a request, so it lives in the address bar. It also
// makes a filtered directory a link an organizer can send to a colleague.
//
// Parsing is total. Every malformed value falls back to a default rather than throwing,
// because these strings are whatever is in the address bar.
//
// It is a sibling of the Abstracts codec rather than a generalization of it. That one
// carries a tab id and a track id, neither of which this surface has, and folding the two
// together would produce one function with four optional halves. The engine they share is
// the one that matters and it is already shared (`features/views/table-query.ts`).

import {
  type DataTableFilter,
  type DataTableSort,
  DEFAULT_PAGE_SIZE,
  FILTER_OPERATORS,
  type FilterOperator,
  PAGE_SIZE_OPTIONS,
} from '@/components/primitives/data-table-types'
import { SPEAKER_CRM_CATALOG } from '@/constants/speaker-crm-fields'

export const CRM_QUERY_KEYS = {
  search: 'q',
  sort: 'sort',
  filter: 'f',
  page: 'page',
  size: 'size',
  duplicates: 'dupes',
} as const

/** `~` because a filter value routinely contains a dot, a dash, and a colon. */
const PART = '~'

export type CrmQueryState = {
  readonly search: string
  readonly sort: DataTableSort | null
  readonly filters: readonly DataTableFilter[]
  readonly page: number
  readonly pageSize: number
  /**
   * Show only the records that look like duplicates of another record.
   *
   * Not a `DataTableFilter`, deliberately. A filter compares one column against a value, and
   * "is a duplicate" is a property of the SET rather than of a cell: it is decided by
   * `findDuplicateClusters` over every row in scope, so there is no accessor for the filter
   * engine to read and no value for the Filter pane to offer. Putting it in the URL anyway is
   * what makes a duplicate review a link an organizer can send to a colleague, which is the
   * same reason everything else in this codec is there.
   */
  readonly duplicatesOnly: boolean
}

/**
 * The plain object Next hands a page. Structurally identical to the Abstracts codec's
 * type of the same name, and deliberately not imported from it: the review feature should
 * not become a dependency of the CRM over a two-line shape.
 */
export type RawSearchParams = Record<string, string | readonly string[] | undefined>

const QUERYABLE_KEYS = new Set(SPEAKER_CRM_CATALOG.queryableFields.map((field) => field.key))

/**
 * A sort or filter is honoured only on a key the directory actually offers.
 *
 * Note what this does NOT check: `column: true`. The Abstracts codec checks it because
 * Airtable does that surface's sorting, and nothing outside a real column can be sorted
 * there. This one runs the whole query in memory over `SPEAKER_ACCESSORS`, so the test is
 * whether the catalog offers the key at all.
 */
function isQueryableKey(key: string): boolean {
  return QUERYABLE_KEYS.has(key)
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
  // The id is positional. Nothing persists it, and the drawer only needs it to be stable
  // within one render pass.
  return [{ id: `f${index}`, key, operator: operator as FilterOperator, value: rest.join(PART) }]
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

export function parseCrmQuery(params: RawSearchParams): CrmQueryState {
  const source = new Map(Object.entries(params))
  const get = (key: string) => first(source.get(key))

  return {
    search: get(CRM_QUERY_KEYS.search) ?? '',
    sort: parseSort(get(CRM_QUERY_KEYS.sort)),
    filters: all(source.get(CRM_QUERY_KEYS.filter)).flatMap(parseFilter),
    page: parseCount(get(CRM_QUERY_KEYS.page), 1),
    pageSize: parseCount(get(CRM_QUERY_KEYS.size), DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS),
    // Only the exact string turns it on, so a stray `?dupes=0` reads as off rather than as
    // "present, therefore true". Parsing stays total: anything else is simply false.
    duplicatesOnly: get(CRM_QUERY_KEYS.duplicates) === '1',
  }
}

export type CrmQueryPatch = {
  readonly search?: string
  readonly sort?: DataTableSort | null
  readonly filters?: readonly DataTableFilter[]
  readonly page?: number
  readonly pageSize?: number
  readonly duplicatesOnly?: boolean
}

/**
 * Serialize a patched query back to a search string.
 *
 * Anything that changes the result set resets the page to 1 unless the patch names a page
 * explicitly. Without that, tightening a filter can land you on page 4 of a two-page list
 * and the table looks empty for no visible reason.
 */
export function buildCrmSearch(current: CrmQueryState, patch: CrmQueryPatch): string {
  const next: CrmQueryState = { ...current, ...patch }
  const params = new URLSearchParams()

  if (next.search.length > 0) params.set(CRM_QUERY_KEYS.search, next.search)
  if (next.sort !== null) {
    params.set(CRM_QUERY_KEYS.sort, `${next.sort.key}${PART}${next.sort.direction}`)
  }
  for (const filter of next.filters) {
    params.append(
      CRM_QUERY_KEYS.filter,
      `${filter.key}${PART}${filter.operator}${PART}${filter.value}`,
    )
  }

  if (next.duplicatesOnly) params.set(CRM_QUERY_KEYS.duplicates, '1')

  const resets = patch.page === undefined && changesResultSet(patch)
  const page = resets ? 1 : next.page
  if (page > 1) params.set(CRM_QUERY_KEYS.page, String(page))
  if (next.pageSize !== DEFAULT_PAGE_SIZE) params.set(CRM_QUERY_KEYS.size, String(next.pageSize))

  const query = params.toString()
  return query.length === 0 ? '' : `?${query}`
}

function changesResultSet(patch: CrmQueryPatch): boolean {
  return (
    patch.search !== undefined ||
    patch.filters !== undefined ||
    patch.pageSize !== undefined ||
    // Turning the duplicates view on takes 19 rows down to 5; without this the organizer
    // stays on page 2 and is shown an empty table by a control they just pressed.
    patch.duplicatesOnly !== undefined
  )
}

// Saved views, as rules rather than as a screen.
//
// Everything the Saved Views control decides is here: whether the table already shows a
// view, which of its three parts differ, which view a surface opens on, whether a name is
// usable, and which rows a write has to clear to keep one default per surface. None of it
// touches Airtable, React, or the clock, which is why it is unit tested
// (tests/saved-views.test.ts) rather than debugged through the dropdown.
//
// Two decisions are load-bearing and both are tested.
//
// A filter's `id` is positional and is NOT persisted (`abstracts-query.ts` says the same
// about the URL form: "The id is positional. Nothing persists it"). So equality ignores it
// and `applySavedView` renumbers, which is what stops "apply the view you are already on"
// from reporting a change every time.
//
// Order is part of the state, for columns and for filters. Columns because the drawer's
// right-hand panel exists to reorder them, so a view that restored the same set in a
// different order would not restore the view. Filters because they are evaluated as a
// list and a reader compares them top to bottom.

import {
  type DataTableFilter,
  type DataTableSort,
  FILTER_OPERATORS,
  type FilterOperator,
} from '@/components/primitives/data-table-types'
import { SAVED_VIEW_NAME_MAX, type SavedView, type SavedViewState } from '@/types/saved-views'

/** The three parts of a view, in the order the Preferences drawer tabs them. */
export const SAVED_VIEW_PARTS = ['columns', 'sort', 'filter'] as const
export type SavedViewPart = (typeof SAVED_VIEW_PARTS)[number]

function sameColumns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right.at(index))
}

function sameSort(left: SavedViewState['sort'], right: SavedViewState['sort']): boolean {
  if (left === null || right === null) return left === right
  return left.key === right.key && left.direction === right.direction
}

/** Ignores `id`: see the header. */
function sameFilter(left: DataTableFilter, right: DataTableFilter): boolean {
  return left.key === right.key && left.operator === right.operator && left.value === right.value
}

function sameFilters(left: readonly DataTableFilter[], right: readonly DataTableFilter[]): boolean {
  if (left.length !== right.length) return false
  return left.every((filter, index) => {
    const other = right.at(index)
    return other !== undefined && sameFilter(filter, other)
  })
}

export function sameSavedViewState(left: SavedViewState, right: SavedViewState): boolean {
  return savedViewDiff(left, right).length === 0
}

/**
 * Which parts of a view the table is not currently showing.
 *
 * A list rather than a boolean because the control says what applying will change, and
 * "Columns and Filter differ" is the difference between a safe click and losing the sort
 * an organizer just set up.
 */
export function savedViewDiff(
  view: SavedViewState,
  state: SavedViewState,
): readonly SavedViewPart[] {
  const parts: SavedViewPart[] = []
  if (!sameColumns(view.columnKeys, state.columnKeys)) parts.push('columns')
  if (!sameSort(view.sort, state.sort)) parts.push('sort')
  if (!sameFilters(view.filters, state.filters)) parts.push('filter')
  return parts
}

/**
 * The table state a view restores, with filter ids renumbered.
 *
 * Copies every array. A view is read once per navigation and applied many times, so
 * handing the caller the stored arrays would let a drag-to-reorder in the drawer mutate
 * the view it came from.
 */
export function applySavedView(view: SavedViewState): SavedViewState {
  return {
    columnKeys: [...view.columnKeys],
    sort: view.sort === null ? null : { ...view.sort },
    filters: view.filters.map((filter, index) => ({ ...filter, id: `v${index}` })),
  }
}

/** By name, case insensitively, so the dropdown order does not depend on Airtable's. */
export function sortSavedViews(views: readonly SavedView[]): readonly SavedView[] {
  return [...views].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
  )
}

/**
 * The view a surface opens on.
 *
 * Airtable cannot express "at most one default per surface", so two flagged rows are a
 * state the base can reach (an organizer ticking the checkbox in Airtable directly).
 * Sorting first makes the answer the same on every request instead of depending on record
 * order, which is what stops a surface from opening on a different view each reload.
 */
export function defaultSavedView(views: readonly SavedView[]): SavedView | undefined {
  return sortSavedViews(views).find((view) => view.isDefault)
}

function normalized(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/**
 * Why a name cannot be used, or `undefined`.
 *
 * A message rather than a boolean, because the control shows it and the action reuses the
 * same check: a name validated in the browser only is a name an organizer can bypass.
 * `exceptId` is the row being renamed, which must be allowed to keep its own name.
 */
export function checkSavedViewName(
  raw: string,
  existing: readonly SavedView[],
  exceptId?: string,
): string | undefined {
  const name = raw.trim()
  if (name.length === 0) return 'Enter a name for this view.'
  if (name.length > SAVED_VIEW_NAME_MAX) return 'That name is too long.'
  const clash = existing.some(
    (view) => view.id !== exceptId && normalized(view.name) === normalized(name),
  )
  return clash ? 'A view called that already exists.' : undefined
}

/**
 * The ids whose `isDefault` a write has to clear so `nextDefaultId` is the only default.
 *
 * Pure so the mutation does not have to work it out while holding a client: the write is
 * "clear these, then set that one", and the list is usually empty.
 */
export function clearedDefaults(
  views: readonly SavedView[],
  nextDefaultId: string | undefined,
): readonly string[] {
  return views.filter((view) => view.isDefault && view.id !== nextDefaultId).map((view) => view.id)
}

/**
 * How many columns and filters one view may store.
 *
 * A ceiling rather than a guess: the registry holds a couple of dozen fields, so a view
 * naming a hundred columns is not a preference an organizer expressed, and the state
 * crosses the Server Action boundary as client input that ends up in a long-text cell.
 */
const MAX_COLUMNS = 100
const MAX_FILTERS = 50

/**
 * Structural sanitation for a view state arriving from the browser.
 *
 * It is client input: a Server Action is a POST endpoint anybody can call, so the state has
 * to be narrowed before it is serialized into a cell that a later read parses back with Zod.
 * The keys themselves are NOT checked against the field registry, deliberately. Two of the
 * Abstracts columns (Session Submitter, Speaker) are not registry entries at all, the
 * DataTable already drops a key it has no renderer for, and the sort and filter keys are
 * re-validated against `column: true` when an applied view round-trips through the URL
 * (`abstracts-query.ts`). Checking here would reject two real columns to duplicate a check
 * that already happens elsewhere.
 */
export function sanitizeSavedViewState(state: SavedViewState): SavedViewState {
  const columnKeys = [...new Set(state.columnKeys.filter((key) => key.length > 0))].slice(
    0,
    MAX_COLUMNS,
  )

  const sort: DataTableSort | null =
    state.sort === null || state.sort.key.length === 0
      ? null
      : { key: state.sort.key, direction: state.sort.direction === 'desc' ? 'desc' : 'asc' }

  const filters = state.filters
    .filter((filter) => filter.key.length > 0 && isOperator(filter.operator))
    .slice(0, MAX_FILTERS)
    .map((filter, index) => ({
      id: `v${index}`,
      key: filter.key,
      operator: filter.operator,
      value: filter.value,
    }))

  return { columnKeys, sort, filters }
}

function isOperator(operator: string): operator is FilterOperator {
  return FILTER_OPERATORS.some((candidate) => candidate === operator)
}

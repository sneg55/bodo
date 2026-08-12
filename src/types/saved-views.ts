// A saved view: one named column, sort and filter set an organizer can restore.
//
// The `surface` vocabulary is the same four values the SavedViews migration declares
// (src/migrations/tables-review.ts). It is re-declared here rather than imported because
// the migration keeps it private, and a select column's option list has to be spelled the
// same on both sides or a write is rejected by Airtable at runtime.
//
// The sort and filter shapes are the DataTable's own, deliberately. A saved view IS table
// state, so a parallel pair of types would only need converting at every boundary, and
// the conversion is where a stored view stops matching the table it was saved from.

import type { DataTableFilter, DataTableSort } from '@/components/primitives/data-table-types'
import type { RecordId } from '@/types/domain'

export const SAVED_VIEW_SURFACES = ['abstracts', 'sessions', 'forms', 'tasks'] as const
export type SavedViewSurface = (typeof SAVED_VIEW_SURFACES)[number]

/** The Agenda List is a session list, so it stores under the `sessions` surface. */
export const AGENDA_LIST_SURFACE: SavedViewSurface = 'sessions'
export const ABSTRACTS_SURFACE: SavedViewSurface = 'abstracts'

/**
 * Everything a view restores. Named separately from `SavedView` because the create
 * action, the diff, and the apply all take the state without the record around it.
 */
export type SavedViewState = {
  readonly columnKeys: readonly string[]
  readonly sort: DataTableSort | null
  readonly filters: readonly DataTableFilter[]
}

export type SavedView = SavedViewState & {
  readonly id: RecordId
  readonly eventId: RecordId
  readonly name: string
  readonly surface: SavedViewSurface
  /**
   * The AdminUsers row that created it, when there is one. Optional because a view
   * seeded in Airtable directly has no owner and must still load.
   */
  readonly ownerId?: RecordId
  /** The view the surface opens on. At most one per surface; see `saved-view-model`. */
  readonly isDefault: boolean
}

/** The longest name the control accepts, matching the 255 the registry uses for text. */
export const SAVED_VIEW_NAME_MAX = 255

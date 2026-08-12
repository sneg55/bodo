// App input to an Airtable field set, for SavedViews.
//
// Inherits the rule to-fields.ts exists for: a link is an ARRAY even when it holds one id,
// `null` CLEARS a column, and an ABSENT key leaves the old value in place.
//
// The decision specific to this table is that the three JSON columns are ALWAYS present on
// an update and carry a serialized value even when the set is empty. `[]` and `null` are
// meaningful states here: an organizer who removes every filter and re-saves the view means
// the view has no filters, and an omitted key would leave the old filter in place while the
// dropdown claimed the view had been updated. `compact` would drop them, which is why the
// update builder does not use it.
//
// A filter's positional `id` is stripped before serializing. See mapping-saved-views.ts.

import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'
import type { SavedViewState, SavedViewSurface } from '@/types/saved-views'

export type SavedViewDraft = {
  eventId: RecordId
  name: string
  surface: SavedViewSurface
  /** The AdminUsers row creating it. Optional so a seeded row can have no owner. */
  ownerId?: RecordId
  state: SavedViewState
  isDefault: boolean
}

function stateFields(state: SavedViewState): FieldSet {
  return {
    [COL.columnsJson]: JSON.stringify(state.columnKeys),
    [COL.sortJson]: JSON.stringify(state.sort),
    [COL.filterJson]: JSON.stringify(
      state.filters.map((filter) => ({
        key: filter.key,
        operator: filter.operator,
        value: filter.value,
      })),
    ),
  }
}

/**
 * A new SavedViews row.
 *
 * `compact` covers the owner link only: everything else is always written, including
 * `isDefault: false`, because the flag is what a surface opens on and "unchanged" is never
 * the right reading of a create.
 */
export function savedViewFields(draft: SavedViewDraft): FieldSet {
  return compact({
    [COL.name]: draft.name,
    [COL.event]: link(draft.eventId),
    [COL.surface]: draft.surface,
    [COL.owner]: draft.ownerId === undefined ? undefined : link(draft.ownerId),
    ...stateFields(draft.state),
    [COL.isDefault]: draft.isDefault,
  })
}

/**
 * An update to an existing row's stored state, optionally renaming it.
 *
 * Neither the event link nor the surface is re-sent. A view does not move between events or
 * between lists, and re-sending either would make a mis-passed id a silent re-parenting
 * rather than a failed write.
 */
export function savedViewStateFields(state: SavedViewState, name?: string): FieldSet {
  return compact({ [COL.name]: name, ...stateFields(state) })
}

/** The default flag on its own, so marking a default never rewrites a stored view. */
export function savedViewDefaultFields(isDefault: boolean): FieldSet {
  return { [COL.isDefault]: isDefault }
}

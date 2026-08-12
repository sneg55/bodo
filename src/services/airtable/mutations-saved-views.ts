// Writes to SavedViews. BUILD_SPEC section 3.
//
// Same posture as the rest of the write side: no fixture branch, and `getClient()` throws
// CFG_ENV_MISSING with no base configured, because a Save view that reports success and
// stores nothing is worse than one that fails.
//
// Every function ends in invalidate.ts naming `eventSavedViewsTag` and nothing else. A saved
// view is a preference OVER a list, not part of it, so creating one must not expire the
// submissions the list is drawn from: that is the granularity rule in BUILD_SPEC 6.1 and it
// is the whole reason this table gets its own tag.
//
// `clearIds` is passed in rather than worked out here. Which rows have to lose the default
// flag is a rule (`clearedDefaults` in @/features/views/saved-view-model, unit tested), and
// the caller has already read the uncached list to apply it.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapSavedView } from '@/services/airtable/mapping-saved-views'
import { TABLES } from '@/services/airtable/tables'
import { eventSavedViewsTag } from '@/services/airtable/tags'
import {
  type SavedViewDraft,
  savedViewDefaultFields,
  savedViewFields,
  savedViewStateFields,
} from '@/services/airtable/to-fields-saved-views'
import type { RecordId } from '@/types/domain'
import type { SavedView, SavedViewState } from '@/types/saved-views'

export async function createSavedView(
  draft: SavedViewDraft,
  origin: WriteOrigin = 'action',
): Promise<SavedView> {
  const created = await getClient().createRecords(TABLES.savedViews, [savedViewFields(draft)])
  const record = created.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'SavedViews: write returned no record', {
      table: TABLES.savedViews,
      name: draft.name,
    })
  }
  invalidate(origin, { own: [eventSavedViewsTag(draft.eventId)] })
  return mapSavedView(record)
}

/** Overwrite what a view stores, optionally renaming it. Leaves the default flag alone. */
export async function updateSavedViewState(
  input: { viewId: RecordId; eventId: RecordId; state: SavedViewState; name?: string },
  origin: WriteOrigin = 'action',
): Promise<void> {
  try {
    await getClient().updateRecords(TABLES.savedViews, [
      { id: input.viewId, fields: savedViewStateFields(input.state, input.name) },
    ])
  } finally {
    invalidate(origin, { own: [eventSavedViewsTag(input.eventId)] })
  }
}

/**
 * Make one view the surface's default, or clear the default entirely.
 *
 * The clears go FIRST and in one batched update. Airtable has no unique index and no
 * transaction, so the only orderings available are "briefly no default" and "briefly two
 * defaults". The first is chosen: with no default the surface opens on its own column set,
 * which is a state the product already has, whereas two defaults makes `defaultSavedView`
 * pick by name and an organizer sees a view they did not ask for.
 *
 * `finally` on the invalidation because a committed clear with a failed set is still a
 * change, and leaving the cache holding the pre-write snapshot shows a default that no
 * longer exists in the base.
 */
export async function setSavedViewDefault(
  input: {
    eventId: RecordId
    /** `undefined` clears the default without setting a new one. */
    viewId?: RecordId
    /** Rows that currently hold the flag and must lose it. May be empty. */
    clearIds: readonly RecordId[]
  },
  origin: WriteOrigin = 'action',
): Promise<void> {
  const client = getClient()
  try {
    if (input.clearIds.length > 0) {
      await client.updateRecords(
        TABLES.savedViews,
        input.clearIds.map((id) => ({ id, fields: savedViewDefaultFields(false) })),
      )
    }
    if (input.viewId !== undefined) {
      await client.updateRecords(TABLES.savedViews, [
        { id: input.viewId, fields: savedViewDefaultFields(true) },
      ])
    }
  } finally {
    invalidate(origin, { own: [eventSavedViewsTag(input.eventId)] })
  }
}

export async function deleteSavedView(
  input: { viewId: RecordId; eventId: RecordId },
  origin: WriteOrigin = 'action',
): Promise<void> {
  try {
    await getClient().deleteRecords(TABLES.savedViews, [input.viewId])
  } finally {
    invalidate(origin, { own: [eventSavedViewsTag(input.eventId)] })
  }
}

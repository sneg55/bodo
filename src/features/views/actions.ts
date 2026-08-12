'use server'

// Saved Views writes: create, overwrite, delete, and mark the surface default.
//
// Each one authorizes for itself with `requireEventRole(input.eventId, 'admin')`, because an
// action is reachable by POST whether or not the layout rendered a control for it, and the
// capability comes from EventMemberships rather than from anything in the session cookie
// (BUILD_SPEC section 4). `admin` and not `reviewer`: a reviewer reads the Abstracts table
// and can APPLY a stored view, which is client state and no write at all, but the default
// flag decides what every organizer on the event opens on, and the SavedViews `owner` column
// links to AdminUsers.
//
// Each one also re-reads the event's own views UNCACHED before writing. That re-read is the
// ownership check, not a convenience: a record id arriving in an action is client input, so
// acting on it alone would let an admin on one event delete another event's view, or move a
// view between the Abstracts and Agenda dropdowns. It is also what the duplicate-name check
// and the "one default per surface" rule are computed from, and both have to see the base as
// it is now rather than as a cached list remembers it.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import {
  checkSavedViewName,
  clearedDefaults,
  sanitizeSavedViewState,
} from '@/features/views/saved-view-model'
import {
  createSavedView,
  deleteSavedView,
  setSavedViewDefault,
  updateSavedViewState,
} from '@/services/airtable/mutations-saved-views'
import { listSavedViewsUncached } from '@/services/airtable/reads-saved-views'
import type { RecordId } from '@/types/domain'
import type { SavedView, SavedViewState, SavedViewSurface } from '@/types/saved-views'

type SurfaceInput = { eventId: RecordId; surface: SavedViewSurface }

/** Authorize, then read the surface's views as the base has them right now. */
async function authorizeAndRead(
  input: SurfaceInput,
): Promise<{ userId: RecordId; views: readonly SavedView[] }> {
  const { userId } = await requireEventRole(input.eventId, 'admin')
  const views = await listSavedViewsUncached(input.eventId, input.surface)
  return { userId, views }
}

function assertOwned(views: readonly SavedView[], viewId: RecordId): SavedView {
  const match = views.find((view) => view.id === viewId)
  if (match !== undefined) return match
  throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that view is not on this list', { viewId })
}

export async function createSavedViewAction(
  input: SurfaceInput & { name: string; state: SavedViewState; isDefault?: boolean },
): Promise<ActionResult<{ view: SavedView }>> {
  try {
    const { userId, views } = await authorizeAndRead(input)

    const problem = checkSavedViewName(input.name, views)
    if (problem !== undefined) {
      throw new AppError(ErrorIds.DATA_WRITE_FAIL, problem, { name: input.name })
    }

    const isDefault = input.isDefault === true
    const view = await createSavedView({
      eventId: input.eventId,
      surface: input.surface,
      name: input.name.trim(),
      ownerId: userId,
      state: sanitizeSavedViewState(input.state),
      isDefault,
    })

    // Only after the row exists, so a failed create cannot leave the surface with no
    // default at all. `clearedDefaults` is computed against the pre-create list, which is
    // correct: the new row is the one becoming the default.
    if (isDefault) {
      await setSavedViewDefault({
        eventId: input.eventId,
        viewId: view.id,
        clearIds: clearedDefaults(views, view.id),
      })
    }

    return actionOk({ view })
  } catch (error) {
    return actionFailure(error)
  }
}

/** Overwrite what a view stores with the table's current state. */
export async function updateSavedViewAction(
  input: SurfaceInput & { viewId: RecordId; state: SavedViewState },
): Promise<ActionResult<{ id: RecordId }>> {
  try {
    const { views } = await authorizeAndRead(input)
    assertOwned(views, input.viewId)

    await updateSavedViewState({
      viewId: input.viewId,
      eventId: input.eventId,
      state: sanitizeSavedViewState(input.state),
    })
    return actionOk({ id: input.viewId })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Make one view the surface's default, or clear the default entirely.
 *
 * `viewId: null` is the clear, and it is a separate value from an absent one so a client
 * bug cannot turn "stop defaulting" into "leave it as it was".
 */
export async function setSavedViewDefaultAction(
  input: SurfaceInput & { viewId: RecordId | null },
): Promise<ActionResult<{ id: RecordId | null }>> {
  try {
    const { views } = await authorizeAndRead(input)
    if (input.viewId !== null) assertOwned(views, input.viewId)

    const nextId = input.viewId ?? undefined
    await setSavedViewDefault({
      eventId: input.eventId,
      viewId: nextId,
      clearIds: clearedDefaults(views, nextId),
    })
    return actionOk({ id: input.viewId })
  } catch (error) {
    return actionFailure(error)
  }
}

export async function deleteSavedViewAction(
  input: SurfaceInput & { viewId: RecordId },
): Promise<ActionResult<{ id: RecordId }>> {
  try {
    const { views } = await authorizeAndRead(input)
    assertOwned(views, input.viewId)

    await deleteSavedView({ viewId: input.viewId, eventId: input.eventId })
    return actionOk({ id: input.viewId })
  } catch (error) {
    return actionFailure(error)
  }
}

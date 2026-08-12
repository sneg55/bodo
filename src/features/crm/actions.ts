'use server'

// The CRM's writes: saved speaker lists, and the speaker tag vocabulary and its membership.
//
// AUTHORIZATION IS RECOMPUTED HERE, in every one of them, and never taken from the layout.
// `(admin)/admin/crm/layout.tsx` says so in its own header: a Server Action is reachable by
// POST whether or not the layout ever rendered, and a layout does not revalidate on every
// navigation, so it is a convenience for a browser and not a security boundary. Each action
// starts with `requireCrmScope()` and then checks every record it is about to touch against
// the scope that came back. Capability comes from EventMemberships, never from a role baked
// into the session cookie (BUILD_SPEC section 4).
//
// Each returns an `ActionResult` rather than throwing, for the reason `action-result.ts`
// gives: a thrown error crossing the action boundary reaches the browser as a redacted
// digest, so an organizer who picked a name that is already taken would be told "an error
// occurred" instead of being told the name is taken.
//
// TWO OWNERSHIP RULES, and neither is the DAL's job:
//
//   - A LIST is writable only by its owner. `deleteSpeakerList`'s doc comment is explicit
//     that its `ownerId` argument names a cache tag and is NOT a permission check, so
//     handing it the caller's id would be exactly the bug it warns about. `ownedList`
//     (lists.ts) is the rule, and the owner's own id is what both writes are given, so the
//     tag that gets expired is the tag the owner reads through. Sharing grants READ only.
//   - A SPEAKER is writable only through an event the caller belongs to.
//     `listSpeakersInEvents(scope.eventIds)` already intersects each speaker's event links
//     with the viewer's memberships and drops anyone left with none, so a record id
//     belonging to somebody else's event resolves to nothing here. It is the same read the
//     directory and the profile just performed, under the same cache entry, so the check
//     costs no request.
//
// The tag vocabulary is GLOBAL and any CRM-scoped organizer may add to it. That is a
// deliberate consequence of the table having no event link (`speakerTagsTag()` takes no
// argument): there is no narrower scope available to authorize against, and a vocabulary
// only one person may extend is a vocabulary nobody else uses.

import type { DataTableFilter } from '@/components/primitives/data-table-types'
import { AppError, ErrorIds } from '@/constants/errorIds'
import {
  checkListFilters,
  checkListName,
  ownedList,
  sanitizeListFilters,
} from '@/features/crm/lists'
import { type CrmScope, requireCrmScope } from '@/features/crm/scope'
import {
  checkTagName,
  isSpeakerTagColor,
  knownTagIds,
  nextTagColor,
  SPEAKER_TAG_NAME_MAX,
} from '@/features/crm/tag-vocabulary'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import {
  createSpeakerTag,
  deleteSpeakerList,
  saveSpeakerList,
  setSpeakerTags,
} from '@/services/airtable/mutations-crm'
import {
  listSpeakerLists,
  listSpeakersInEvents,
  listSpeakerTags,
} from '@/services/airtable/queries'
import type { RecordId, SpeakerList, SpeakerTag } from '@/types/domain'

/**
 * Scope, plus the lists that scope may see.
 *
 * Cached rather than uncached, unlike the Saved Views actions, and the difference is worth
 * recording. Those re-read uncached because they compute a per-surface default from what
 * the base holds right now, so a stale snapshot could leave two rows flagged. Nothing here
 * is computed across rows: the checks are "is this row mine" and "is this name taken", and
 * ownership does not change through the app. Every write to SpeakerLists expires both tags
 * this read subscribes to (`saveSpeakerList` and `deleteSpeakerList` name them
 * unconditionally), so the only way to see a stale row is a hand edit made in Airtable
 * inside the revalidation window.
 */
async function scopeAndLists(): Promise<{ scope: CrmScope; lists: readonly SpeakerList[] }> {
  const scope = await requireCrmScope()
  // Not re-filtered through `visibleLists`: `listSpeakerLists` applies it and is the one
  // place it runs. See its doc in reads-crm.ts.
  return { scope, lists: await listSpeakerLists(scope.userId) }
}

function refuse(id: (typeof ErrorIds)[keyof typeof ErrorIds], message: string): never {
  throw new AppError(id, message)
}

export type SaveSpeakerListInput = {
  /** Absent to create. Present to rename, re-share, or overwrite an existing list. */
  readonly id?: string
  readonly name: string
  readonly isShared: boolean
  readonly filters: readonly DataTableFilter[]
}

/**
 * Create a list from the filters the directory is showing, or overwrite one.
 *
 * `ownerId` is never taken from the client. On a create it is the caller; on an update it
 * is the row's EXISTING owner, read back off the list this caller was allowed to find,
 * which is the same person because only the owner reaches this line at all.
 */
export async function saveSpeakerListAction(
  input: SaveSpeakerListInput,
): Promise<ActionResult<{ list: SpeakerList }>> {
  try {
    const { scope, lists } = await scopeAndLists()

    const existing =
      input.id === undefined
        ? undefined
        : (ownedList(lists, input.id, scope.userId) ?? refuseList())

    const name = checkListName(input.name, lists, input.id)
    if (!name.ok) refuse(ErrorIds.DATA_WRITE_FAIL, name.reason)

    // A list is a filter set, so a list storing none of them is refused rather than written.
    // Checked AFTER sanitation, by `checkListFilters` itself, because a set of filters that
    // are all dropped is the same thing as no filters at all. See `hasFilters` in lists.ts.
    const filters = checkListFilters(input.filters)
    if (!filters.ok) refuse(ErrorIds.DATA_WRITE_FAIL, filters.reason)

    const list = await saveSpeakerList('action', {
      id: existing?.id,
      name: input.name.trim(),
      ownerId: existing?.ownerId ?? scope.userId,
      isShared: input.isShared,
      filters: sanitizeListFilters(input.filters),
    })
    return actionOk({ list })
  } catch (error) {
    return actionFailure(error)
  }
}

export async function deleteSpeakerListAction(input: {
  listId: string
}): Promise<ActionResult<{ id: string }>> {
  try {
    const { scope, lists } = await scopeAndLists()
    const list = ownedList(lists, input.listId, scope.userId) ?? refuseList()

    // The OWNER's id, which is this caller's, because nothing else got past `ownedList`.
    // Passing `scope.userId` directly would type-check and would be the bug the mutation's
    // own doc comment describes. `ownedList` returns `OwnedSpeakerList`, so `ownerId` is
    // present here and there is no fallback for the caller's id to hide in.
    await deleteSpeakerList('action', list.id, list.ownerId)
    return actionOk({ id: input.listId })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * One answer for "not yours" and "not there", so a probe cannot tell an id that does not
 * exist from another organizer's private list. The same reasoning `loadSpeakerProfile`
 * gives for its 404.
 */
function refuseList(): never {
  refuse(ErrorIds.DATA_RECORD_NOT_FOUND, 'that list is not one of yours')
}

/**
 * Replace one speaker's tag membership.
 *
 * The whole set, not a delta, because that is what `setSpeakerTags` takes and because the
 * editor is a multi-select: sending "the chips that are on now" is a state an out-of-date
 * editor cannot corrupt into a half-applied one.
 */
export async function setSpeakerTagsAction(input: {
  speakerId: RecordId
  tagIds: readonly string[]
}): Promise<ActionResult<{ tagIds: readonly string[] }>> {
  try {
    const scope = await requireCrmScope()
    const [roster, vocabulary] = await Promise.all([
      listSpeakersInEvents(scope.eventIds),
      listSpeakerTags(),
    ])

    if (!roster.some((entry) => entry.speaker.id === input.speakerId)) {
      refuse(ErrorIds.DATA_RECORD_NOT_FOUND, 'that speaker is not on any of your events')
    }

    const tagIds = knownTagIds(input.tagIds, vocabulary)
    if (tagIds.length !== new Set(input.tagIds).size) {
      // Not silent: the editor is showing a vocabulary that has since lost a tag, and
      // writing the remainder anyway would look like the click did nothing.
      refuse(ErrorIds.DATA_WRITE_FAIL, 'that tag no longer exists. Reload and try again.')
    }

    await setSpeakerTags('action', input.speakerId, tagIds)
    return actionOk({ tagIds })
  } catch (error) {
    return actionFailure(error)
  }
}

/** Add a tag to the global vocabulary. Applying it is a separate write, by design. */
export async function createSpeakerTagAction(input: {
  name: string
  color?: string
}): Promise<ActionResult<{ tag: SpeakerTag }>> {
  try {
    await requireCrmScope()
    const vocabulary = await listSpeakerTags()

    const name = checkTagName(input.name, vocabulary)
    if (!name.ok) refuse(ErrorIds.DATA_WRITE_FAIL, name.reason)

    const color = input.color ?? nextTagColor(vocabulary)
    if (!isSpeakerTagColor(color)) {
      refuse(ErrorIds.DATA_WRITE_FAIL, 'pick one of the offered colours')
    }

    const tag = await createSpeakerTag('action', {
      name: input.name.trim().slice(0, SPEAKER_TAG_NAME_MAX),
      color,
    })
    return actionOk({ tag })
  } catch (error) {
    return actionFailure(error)
  }
}

// Cross-event reads for the speaker CRM: the roster, the tag vocabulary, saved lists
// and one speaker's sent mail.
//
// The one thing that makes this file different from reads-review.ts and reads-portal.ts
// is the word "cross-event". Every read below either spans several events at once
// (`listSpeakersForEvents`) or was never event-scoped to begin with (`listSpeakerTags`,
// `listSpeakerLists`, `listOutboxForSpeaker`, `listSpeakerTagIds`), so none of them can
// reuse `listByEvent` or an `event:{id}:...` tag. Filtering happens in code, not in an
// Airtable formula, for the same reason `listSpeakers` filters in code: a link field
// reads back as the linked record's primary-field TEXT in a formula, not its id, so
// `{speaker} = 'recSpk1'` matches nothing.

import { visibleLists } from '@/features/crm/lists'
import { getClient } from '@/services/airtable/client'
import { mapSpeaker, speakerEventIds } from '@/services/airtable/mapping'
import {
  mapSpeakerList,
  mapSpeakerTag,
  speakerTagSpeakerIds,
} from '@/services/airtable/mapping-crm'
import { mapOutboxRow } from '@/services/airtable/mapping-portal'
import { REVALIDATE } from '@/services/airtable/read-cache'
import { TABLES } from '@/services/airtable/tables'
import {
  eventSpeakersTag,
  sharedSpeakerListsTag,
  speakerCommsTag,
  speakerTagsTag,
  userSpeakerListsTag,
} from '@/services/airtable/tags'
import type { SpeakerInEvents } from '@/types/crm'
import type { OutboxRow, Speaker, SpeakerList, SpeakerTag } from '@/types/domain'

/**
 * Speakers across several events at once, for the cross-event CRM.
 *
 * Scoped through the `events` link on the Speakers row, the same way `listSpeakers` does
 * for one event (reads-review.ts:81), because a speaker belongs to many events and there
 * is no single eventId to compare. The caller passes the viewer's membership set, so a
 * speaker is reachable only through an event the viewer belongs to.
 *
 * Tagged with one `eventSpeakersTag` per event rather than a single CRM-wide tag: a write
 * on any one event already expires its own tag, and this read subscribes to all of them.
 * `REVALIDATE.edited`, matching `listSpeakers`: a speaker's own row is something an
 * organizer edits and looks at again within the same session.
 */
export async function listSpeakersForEvents(
  eventIds: readonly string[],
): Promise<readonly Speaker[]> {
  return (await listSpeakersInEvents(eventIds)).map((entry) => entry.speaker)
}

/**
 * The same read, keeping each speaker's event links instead of discarding them.
 *
 * The links are already in the records this read pages through (`speakerEventIds`,
 * mapping.ts:104); `Speaker` just has nowhere to put them, because the domain type is a
 * person and "which of YOUR events are they on" is a question about the caller. Dropping
 * them and then asking again per event, which is what the CRM directory did first, is
 * `listAll(TABLES.speakers)` once more per event: the same whole-table scan, filtered in
 * code the same way, under a different cache key so nothing dedupes it. A viewer in twelve
 * events paid twelve of them. Same shape of fix as `listSpeakerTagMembership` above:
 * invert the link once for the whole scope.
 *
 * `eventIds` is intersected with the scope, never returned whole. A speaker's other events
 * are events the viewer holds no membership on, and the count in the directory is "how
 * many of YOUR events", not a fact about the person's career.
 */
export async function listSpeakersInEvents(
  eventIds: readonly string[],
): Promise<readonly SpeakerInEvents[]> {
  if (eventIds.length === 0) return []

  const records = await getClient().listAll(TABLES.speakers, {
    tags: eventIds.map(eventSpeakersTag),
    revalidate: REVALIDATE.edited,
  })

  // Scope FIRST, map second, and the order is load-bearing rather than stylistic. `mapSpeaker`
  // validates at the Airtable boundary and throws DATA_SHAPE_INVALID on a row with a blank
  // Email (mapping.ts -> records.ts `text`). Mapping before filtering would let one malformed
  // row, in an event this viewer holds no membership on and can never see, fail the entire
  // cross-event directory instead of being skipped the way it was before this read existed.
  const scope = new Set(eventIds)
  return records
    .map((record) => ({
      record,
      eventIds: [...new Set(speakerEventIds(record))].filter((id) => scope.has(id)),
    }))
    .filter((entry) => entry.eventIds.length > 0)
    .map((entry) => ({ speaker: mapSpeaker(entry.record), eventIds: entry.eventIds }))
    .sort((left, right) => left.speaker.lastName.localeCompare(right.speaker.lastName))
}

/**
 * The whole speaker tag vocabulary. Global rather than per event (`speakerTagsTag` takes
 * no argument), and `REVALIDATE.lookup`: like Tracks, Tags and Rooms, an organizer defines
 * a handful of these and they change a few times a year, not per request.
 */
export async function listSpeakerTags(): Promise<readonly SpeakerTag[]> {
  const records = await getClient().listAll(TABLES.speakerTags, {
    tags: [speakerTagsTag()],
    revalidate: REVALIDATE.lookup,
  })
  return records.map(mapSpeakerTag)
}

/**
 * One user's saved speaker filters: the CRM directory's list picker.
 *
 * `REVALIDATE.edited`, not `lookup`: a saved list is something the organizer who owns it
 * edits and expects to see updated immediately, the same class of data as a speaker's own
 * row, not a slow-moving vocabulary.
 *
 * Reads the WHOLE table - it has to, because "may this caller see it" depends on a row's
 * `ownerId` and `isShared`, neither knowable before the row is read - but returns only the
 * rows `userId` may actually see: their own, plus every `isShared` one. This filter was
 * missing for two review rounds running even though the function's own name, doc comment
 * and cache key all already said "one user's": round 1 fixed the wording, round 2 fixed the
 * CACHE TAGS so a shared list invalidates correctly, and both times the return value stayed
 * an unfiltered dump of every organizer's lists, private ones included. A read that is right
 * about invalidation and wrong about what it returns is still wrong.
 *
 * Tagged with TWO subscriptions: `userSpeakerListsTag(userId)`, this caller's own, and
 * `sharedSpeakerListsTag()`, so a write by a DIFFERENT user - sharing, renaming, or deleting
 * a list - still expires this cache entry. Without the second tag, user B's cached view of
 * a list user A just deleted would keep showing it until B's own window lapsed. See
 * `sharedSpeakerListsTag`'s doc in tags.ts for why both mutations name it unconditionally.
 * The tags were already correct; only the filter below is new.
 *
 * The filter itself is `visibleLists` from `features/crm/lists.ts` rather than an inline
 * predicate, and that direction is deliberate. This is the ONLY place the rule is applied:
 * the CRM's feature functions used to re-apply it after this read, which was three calls
 * that could never change an outcome. Both copies were in fact tested - this one through
 * `fakeSpeakersApi` in tests/crm-mutations-lists.test.ts, the other directly in
 * tests/crm-lists.test.ts - so the problem was two implementations to keep in step, not an
 * untested one. Now there is one, and both tests point at it: the unit test covers the rule,
 * including the ownerless row, and the fake-API test covers this wiring.
 *
 * A services module importing a pure rule out of `features` is the same shape as
 * `mutations-event.ts` importing `slugTaken` and `mapping-cms.ts` importing
 * `safeStoredEmbedCss`: the rule is the feature's, the read just has to obey it.
 */
export async function listSpeakerLists(userId: string): Promise<readonly SpeakerList[]> {
  const records = await getClient().listAll(TABLES.speakerLists, {
    tags: [userSpeakerListsTag(userId), sharedSpeakerListsTag()],
    revalidate: REVALIDATE.edited,
  })
  return visibleLists(records.map(mapSpeakerList), userId)
}

/**
 * One speaker's sent mail, across every event, for the CRM timeline.
 *
 * `OutboxRow` already carries both `speakerId` and `eventId` (mapping-portal.ts), so this
 * is a filter over the existing mapper rather than new plumbing. `speakerCommsTag`, not
 * `eventOutboxTag`: the CRM timeline reads across events, and an event-scoped tag would
 * not be expired by a send queued on a different event. `REVALIDATE.edited`: an organizer
 * who just triggered a send expects to see it in the timeline within the minute.
 */
export async function listOutboxForSpeaker(speakerId: string): Promise<readonly OutboxRow[]> {
  const records = await getClient().listAll(TABLES.emailOutbox, {
    tags: [speakerCommsTag(speakerId)],
    revalidate: REVALIDATE.edited,
  })
  return records.map(mapOutboxRow).filter((row) => row.speakerId === speakerId)
}

/**
 * EVERY speaker's tag ids, keyed by speaker, from one read of SpeakerTags.
 *
 * The read the cross-event directory needs, and the reason it exists rather than the
 * obvious loop: `listSpeakerTagIds` answers for ONE speaker, and calling it per row is the
 * per-row fan-out `scheduler.ts` was written to prevent ("an admin screen that fans out
 * per-row lookups crosses that line and starts collecting 429s"). A slot is charged before
 * anyone knows whether the answer is coming from cache (`rate-window.ts`), so a page of 25
 * speakers would spend five seconds of the base's budget answering from data it already
 * had. The directory also has to filter and sort on tags across the WHOLE membership set
 * rather than the visible page, so a page-scoped loop would have been wrong as well as slow.
 *
 * Same subscription and same window as `listSpeakerTagIds` below, and the trap is the same
 * one: `speakerTag(speakerId)` looks like the natural tag and is the WRONG one, because it
 * is bound to the Speakers table while this data lives in SpeakerTags. `speakerTagsTag()`
 * is what both writes to that table name (`createSpeakerTag` and `setSpeakerTags` in
 * mutations-crm.ts, the latter inside a `finally`), so it is the only tag that expires this
 * entry. `REVALIDATE.edited`, not `lookup`: this answers MEMBERSHIP, and tagging a speaker
 * from the CRM is a routine edit, unlike the vocabulary `listSpeakerTags` answers.
 *
 * Inverted in code for the same reason everything else in this file filters in code: the
 * `speakers` link reads back in a formula as the linked record's primary-field text, not
 * its id.
 */
export async function listSpeakerTagMembership(): Promise<ReadonlyMap<string, readonly string[]>> {
  const records = await getClient().listAll(TABLES.speakerTags, {
    tags: [speakerTagsTag()],
    revalidate: REVALIDATE.edited,
  })

  const membership = new Map<string, string[]>()
  for (const record of records) {
    // Through a Set: a link cell should not carry the same record twice, and if a row
    // hand-edited in Airtable does, one tag still has to count once.
    for (const speakerId of new Set(speakerTagSpeakerIds(record))) {
      const existing = membership.get(speakerId)
      if (existing === undefined) {
        membership.set(speakerId, [record.id])
        continue
      }
      existing.push(record.id)
    }
  }
  return membership
}

/**
 * The tag ids applied to ONE speaker, for the CRM profile's tag chips.
 *
 * A lookup into the map above rather than a second pass over the same table with the same
 * tag and the same window. Two reads that must stay in step is how they drift: this way
 * there is one cache entry, one set of options, and one place where the inversion rule
 * lives. The call shape is still worth keeping, because a profile knows a speaker id and
 * has no use for everybody else's tags.
 */
export async function listSpeakerTagIds(speakerId: string): Promise<readonly string[]> {
  return (await listSpeakerTagMembership()).get(speakerId) ?? []
}

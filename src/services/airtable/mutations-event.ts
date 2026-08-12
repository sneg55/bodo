// Writes to the Events table. There were none before Event Settings.
//
// Two things here are not boilerplate.
//
// The slug collision lookup is UNCACHED, deliberately: it decides between saving and
// refusing, and a cached answer there is how two events end up answering the same public
// URL. `getEventBySlug` is the cached read and is not reused for this.
//
// The invalidation names BOTH slug tags when the slug changes, which is the whole reason
// `src/features/settings/invalidation.ts` exists as its own tested module. A slug change
// that expires one of them leaves the public agenda serving a stale page under the old
// slug or a cached miss under the new one.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { slugTaken } from '@/features/settings/checks'
import type { EventDetailsWrite } from '@/features/settings/draft'
import type { EventImageField } from '@/features/settings/event-images'
import { eventSettingsInvalidation } from '@/features/settings/invalidation'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapEvent } from '@/services/airtable/mapping'
import { findByText } from '@/services/airtable/reads'
import { view } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { eventIntegrationsTag, eventTag } from '@/services/airtable/tags'
import {
  acceleventsMappingFields,
  eventDetailsFields,
  eventImageFields,
  newEventFields,
} from '@/services/airtable/to-fields-event'
import type { Event, RecordId } from '@/types/domain'

export type EventDetailsChange = {
  eventId: RecordId
  write: EventDetailsWrite
}

/**
 * The live row, uncached.
 *
 * The previous slug is read here rather than accepted from the caller, and it has to be
 * uncached: it is what decides which slug tag gets expired, and a stale one expires a tag
 * nothing is cached under while leaving the real entry serving the old page.
 */
async function readEventForWrite(eventId: RecordId): Promise<Event> {
  return mapEvent(await getClient().getRecord(TABLES.events, eventId))
}

/**
 * True when another event already holds `slug`.
 *
 * Uncached, and filtered server side because `slug` is real text on the table rather than
 * a link (see the note on `getEventBySlug`). Returns the id it found so the caller can
 * name the conflict.
 */
export async function findEventIdBySlug(slug: string): Promise<RecordId | undefined> {
  const record = await findByText(TABLES.events, COL.slug, slug)
  return record === undefined ? undefined : view(TABLES.events, record).id
}

export async function isSlugAvailable(slug: string, selfId: RecordId): Promise<boolean> {
  const holderId = await findEventIdBySlug(slug)
  return holderId === undefined || !slugTaken(slug, selfId, [{ id: holderId, slug }])
}

/**
 * Create the event row.
 *
 * The slug check here is stricter than the one in `updateEventDetails` and the difference
 * is the whole reason this is not that function with an optional id: an update compares
 * against the row's own previous slug and skips the lookup when it has not changed, because
 * an event legitimately holds its own slug. A create has no self to exclude, so ANY holder
 * is a collision, which is why `findEventIdBySlug` is called directly rather than
 * `isSlugAvailable`.
 *
 * Nothing is invalidated here and that is not an oversight. A record that did not exist a
 * moment ago has nothing cached under `event:{id}`, and the read that has to notice this
 * event is the creator's membership list, which `createEventMembership` expires with
 * `user:{id}:memberships` as part of granting them access. Expiring a tag with no entries
 * would be a write pretending to do work.
 */
export async function createEvent(input: {
  write: EventDetailsWrite
  status: string
}): Promise<Event> {
  const holderId = await findEventIdBySlug(input.write.slug)
  if (holderId !== undefined) {
    throw new AppError(
      ErrorIds.DATA_WRITE_FAIL,
      `another event already uses the slug ${input.write.slug}`,
      { slug: input.write.slug, eventId: holderId },
    )
  }

  const created = await getClient().createRecords(TABLES.events, [
    newEventFields(input.write, input.status),
  ])

  const record = created.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Events: create returned no record', {
      slug: input.write.slug,
    })
  }

  return mapEvent(record)
}

/**
 * Save the whole Event Details page.
 *
 * Refuses on a taken slug rather than writing and hoping, because Airtable has no unique
 * constraint to lean on: `slug` is an ordinary text column, so nothing below this function
 * would stop the duplicate.
 */
export async function updateEventDetails(
  change: EventDetailsChange,
  origin: WriteOrigin = 'action',
): Promise<Event> {
  const previousSlug = (await readEventForWrite(change.eventId)).slug
  // Compared RAW on both sides. Normalizing only the previous side made a legacy
  // `Ai-Engineer` slug look unchanged when it was being corrected to `ai-engineer`, which
  // skipped the collision check entirely: another event could already hold the lowercase
  // form. Nothing validates a slug already sitting in Airtable, so a non-canonical one is a
  // real state rather than a hypothetical. Found by Codex review.
  const slugChanged = change.write.slug !== previousSlug.trim()
  if (slugChanged && !(await isSlugAvailable(change.write.slug, change.eventId))) {
    throw new AppError(
      ErrorIds.DATA_WRITE_FAIL,
      `another event already uses the slug ${change.write.slug}`,
      { eventId: change.eventId, slug: change.write.slug },
    )
  }

  const updated = await getClient().updateRecords(TABLES.events, [
    { id: change.eventId, fields: eventDetailsFields(change.write) },
  ])

  const record = updated.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Events: write returned no record', {
      eventId: change.eventId,
    })
  }

  invalidate(
    origin,
    eventSettingsInvalidation({
      eventId: change.eventId,
      previousSlug,
      nextSlug: change.write.slug,
    }),
  )

  return mapEvent(record)
}

/**
 * Store one image URL on the event, for an upload that has already landed in R2.
 *
 * Separate from `updateEventDetails` because it answers a different question. That function
 * saves the whole Event Details page and has to police the slug; this one writes a single
 * column with a URL the upload route derived from a verified object key, so there is no slug
 * to collide and nothing else on the record to touch.
 *
 * The slug is still READ, uncached, and for one reason: it is what decides which tag the
 * public agenda is cached under. `eventSettingsInvalidation` with an unchanged slug expires
 * `event:{id}` and that slug's entry, which is exactly the set of screens a new logo appears
 * on. Passing the same value on both sides is the honest way to say "the slug did not
 * change", rather than a second invalidation function that would drift from the first.
 */
export async function setEventImage(
  change: { eventId: RecordId; field: EventImageField; url: string },
  origin: WriteOrigin = 'route',
): Promise<Event> {
  const slug = (await readEventForWrite(change.eventId)).slug

  const updated = await getClient().updateRecords(TABLES.events, [
    { id: change.eventId, fields: eventImageFields(change.field, change.url) },
  ])

  const record = updated.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Events: image write returned no record', {
      eventId: change.eventId,
      field: change.field,
    })
  }

  invalidate(
    origin,
    eventSettingsInvalidation({ eventId: change.eventId, previousSlug: slug, nextSlug: slug }),
  )

  return mapEvent(record)
}

/**
 * Map this event to an Accelevents event, or clear the mapping.
 *
 * Its own mutation rather than part of `updateEventDetails`, because the two answer
 * different questions and one of them polices the slug. This writes two columns that are
 * integration state, and there is no slug to collide: BUILD_SPEC 5.0d keys remote identity
 * per event through `Events.accelEventUrl` and `accelEventId`, which is bodo's event-scoped
 * stand-in for the vendor's organization-level event mapping.
 *
 * Passing no `eventUrl` is the DISCONNECT, and it clears both columns rather than refusing.
 * That is the direction that cannot lie: an omitted key leaves the old value in place, so a
 * disconnect that did not clear would report success while the event carried on pushing
 * accepted sessions into the same remote event. `acceleventsMappingFields` sends `null` on
 * both columns for the same reason.
 *
 * Both tags, and neither is optional. `eventTag` because `mapEvent` reads these columns and
 * every screen holding an `Event` has just gone stale; `eventIntegrationsTag` because the
 * Integrations page reads its connection state through them and is the screen the organizer
 * is looking at while this runs.
 */
export async function setAcceleventsMapping(
  change: { eventId: RecordId; eventUrl?: string; remoteEventId?: string },
  origin: WriteOrigin = 'action',
): Promise<Event> {
  const updated = await getClient().updateRecords(TABLES.events, [
    { id: change.eventId, fields: acceleventsMappingFields(change) },
  ])

  const record = updated.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Events: write returned no record', {
      eventId: change.eventId,
    })
  }

  invalidate(origin, {
    own: [eventTag(change.eventId), eventIntegrationsTag(change.eventId)],
  })

  return mapEvent(record)
}

// The Events write direction: an Event Details draft to an Airtable field set.
//
// Kept out of to-fields.ts, which is at its size limit and is about submissions,
// participants and speakers. Same rules apply: `compact()` drops `undefined` as "leave
// this column alone", `null` survives as "clear it", and column names come from COL and
// never from a literal (tables.ts).
//
// This is the FIRST write path the Events table has ever had. Before Event Settings only
// `src/migrations` and `scripts/seed` touched that table, which is why there was nothing
// here to extend.

import type { EventDetailsWrite } from '@/features/settings/draft'
import type { EventImageField } from '@/features/settings/event-images'
import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { compact } from '@/services/airtable/to-fields'

/**
 * Every column the Event Details page owns, sent together.
 *
 * One field set rather than a per-control patch, because the parity screen has one Save
 * at the bottom covering the whole page (ref 03 and ref 04, including the group tiles and
 * the images): a partial write would leave the form showing values it had not saved.
 *
 * `eventType` is passed through unvalidated on purpose at this layer. It is a single
 * select, so Airtable answers a value outside the option list with a 422, and the caller
 * has already checked it against EVENT_TYPE_OPTIONS.
 */
export function eventDetailsFields(write: EventDetailsWrite): FieldSet {
  return compact({
    [COL.name]: write.name,
    [COL.slug]: write.slug,
    [COL.eventType]: write.eventType,
    [COL.websiteUrl]: write.websiteUrl,
    [COL.location]: write.location,
    [COL.timezone]: write.timezone,
    [COL.startsAt]: write.startsAt,
    [COL.endsAt]: write.endsAt,
    [COL.theme]: write.theme,
    [COL.logoUrl]: write.logoUrl,
    [COL.backgroundUrl]: write.backgroundUrl,
  })
}

/**
 * The Details columns plus the two an event cannot exist without.
 *
 * `status` and `accelSyncEnabled` are not on the Details form, so `eventDetailsFields`
 * never sends them and an update has no reason to: the row already has values. A create
 * does, and leaving them off would rely on the Airtable column defaults, which are not
 * declared here and are not the base's contract with this code. `mapEvent` reads a blank
 * status as `draft` and a blank checkbox as false, so writing them explicitly makes the
 * stored row say what the reader would have assumed instead of leaving the two disagreeing.
 */
export function newEventFields(write: EventDetailsWrite, status: string): FieldSet {
  return compact({
    ...eventDetailsFields(write),
    [COL.status]: status,
    [COL.accelSyncEnabled]: false,
  })
}

/**
 * The event's Accelevents identity, which is what `Connect` and `Disconnect` write.
 *
 * These two columns are NOT on the Event Details form and are deliberately not added to it.
 * They are integration state rather than event metadata: an organizer editing the venue and
 * the timezone has no business next to the field that decides which remote event bodo pushes
 * accepted sessions into, and BUILD_SPEC 5.0d puts the mapping on the Integrations page for
 * exactly that reason. So this is its own field set with its own action, the same separation
 * `eventImageFields` already makes for a different reason.
 *
 * `null` and not omission on both columns, which is the opposite of what `eventDetailsFields`
 * does and is the whole point of the function. Disconnecting has to CLEAR the mapping, and an
 * omitted key leaves the old value in place, so a disconnect that omitted them would report
 * success and leave the event still pushing into the same remote event. `compact` is
 * therefore not used here.
 *
 * `accelEventId` is optional on the way in because the vendor's URL slug is the identifier
 * their read endpoints take, and the numeric id is only needed by some of them (§5.0e). A
 * connect that knows the URL and not the id is a usable connection, so it is allowed and the
 * id is cleared rather than refused.
 */
export function acceleventsMappingFields(mapping: {
  eventUrl?: string
  remoteEventId?: string
}): FieldSet {
  return {
    [COL.accelEventUrl]: mapping.eventUrl ?? null,
    [COL.accelEventId]: mapping.remoteEventId ?? null,
  }
}

/**
 * One image column, for the upload route rather than the Save button.
 *
 * A single-column field set is the exception this file's header rules out for the form, and
 * the reason it is right here is that the upload is not the form: an organizer picks a file,
 * the bytes are stored and verified, and the URL that names them has to land on the record
 * immediately. Sending the whole page's field set would write back whatever the browser
 * happened to be holding in the other eight controls.
 *
 * Branched rather than indexed by the field name, because `COL[field]` is a computed read
 * that produces a column name and `security/detect-object-injection` is right about those.
 */
export function eventImageFields(field: EventImageField, url: string | null): FieldSet {
  return compact(field === 'logoUrl' ? { [COL.logoUrl]: url } : { [COL.backgroundUrl]: url })
}

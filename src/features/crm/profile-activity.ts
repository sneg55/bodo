// The three things a CRM profile shows that are not the contact's own fields: the notes
// organizers have left on them, the stage moves those organizers made, and the events this
// viewer could still put them on. Plus THE CLOCK the whole profile is read on, which is
// decided here because this is the file that already argued for one.
//
// Split out of `profile.ts` rather than added to it, on the seam that was already there:
// that file assembles WHO THIS PERSON IS (their record, their tags, their sessions, their
// mail) and was at its size budget doing it. Everything here is about what organizers have
// DONE, plus the one forward action the profile offers.
//
// Both logs are read best-effort. `SpeakerNotes` and `SpeakerStageHistory` are the two tables
// a base created before they were declared will not have, and a 404 from Airtable must cost
// the profile its activity panel rather than the whole page - the same call
// `submission-detail.ts` makes for `ContentRevisions`, for the same reason. Run
// `npm run airtable:schema` to add them.

import { type SpeakerNoteRow, speakerNoteRows } from '@/features/crm/notes'
import type { CrmScope } from '@/features/crm/scope'
import { type StageHistoryRow, stageHistoryRows } from '@/features/crm/stage-history'
import { dateTimeText } from '@/features/review/date-text'
import { getEvent } from '@/services/airtable/queries'
import { listSpeakerNotes, type SpeakerNote } from '@/services/airtable/speaker-notes'
import {
  listSpeakerStageChanges,
  type SpeakerStageChange,
} from '@/services/airtable/speaker-stage-history'
import type { RecordId, Speaker } from '@/types/domain'

/** One event the contact is not on yet, for the Add to event picker. */
export type AddableEvent = {
  readonly id: RecordId
  readonly name: string
}

export type ProfileActivity = {
  readonly notes: readonly SpeakerNoteRow[]
  readonly stageHistory: readonly StageHistoryRow[]
}

/** The two logs as stored, before a timezone is known. See `loadProfileActivity`. */
export type ActivityRecords = {
  readonly notes: readonly SpeakerNote[]
  readonly changes: readonly SpeakerStageChange[]
}

/**
 * Both logs, unformatted.
 *
 * It stops short of rendering because the timezone it would render in comes from the
 * contact's first in-scope EVENT, and that read is issued in the same batch as this one. A
 * function that needed the answer to a sibling read would turn one round trip into two, for a
 * date format. `profileActivityRows` finishes the job once both have landed.
 */
export async function loadProfileActivity(speakerId: RecordId): Promise<ActivityRecords> {
  const [notes, changes] = await Promise.all([
    listSpeakerNotes(speakerId).catch(() => []),
    listSpeakerStageChanges(speakerId).catch(() => []),
  ])
  return { notes, changes }
}

/** The clock a profile falls back to when there is no event to take one from. */
export const NO_EVENT_ZONE = 'UTC'

/**
 * THE ONE ZONE the whole profile renders in, and the rule the eval run of 2026-08-10 filed
 * against.
 *
 * The profile used to run on THREE rules at once. The communication timeline rendered each
 * row in its own event's zone, the notes and the stage history rendered in the first event's
 * zone, and a mail whose event had dropped off the profile silently rendered in UTC. Nothing
 * on the surface said which clock any line was on, so a contact spanning an
 * `America/Los_Angeles` event and a `UTC` one showed one list under two clocks seven hours
 * apart in August: "AI Engineer Sandbox, Aug 11, 5:05 AM" was measured on the running app
 * sitting next to "DevFlow Conf 2027, Aug 10, 2:38 PM", and the gap between those two lines
 * is seven hours longer than the gap between the mails. A list nobody can read in order is
 * worse than a list on the wrong clock.
 *
 * So: ONE zone per profile, and every timestamp names it (`zonedDateTimeText`). Two of the
 * three lists could not have had a per-row zone anyway, because a note and a stage move
 * belong to the person and name no event, so per-row zones were never available as a
 * consistent rule. The reader here is one organizer scanning one page, not a venue.
 *
 * The contact's FIRST IN-SCOPE EVENT is the clock, and the two obvious alternatives are not
 * reachable: `AdminUser` carries no timezone and there is no organization record at all
 * (scope is `EventMemberships`), so neither the viewer's own zone nor an org zone exists to
 * pick without a schema change. `profileEventIds` orders by the VIEWER's membership order,
 * so the first entry is the viewer's own top event that this contact is on, which is the
 * nearest thing the schema has to the reader's home clock.
 *
 * The zone is validated before it is returned, and that is not decoration: `Events.timezone`
 * is a free-text column, `Intl.DateTimeFormat` throws `RangeError` on anything it does not
 * recognise, and `dateTimeText` does not guard it. `features/agenda/time.ts` records the same
 * outage and takes the same fallback for the same reason.
 */
export function profileTimezone(events: readonly { readonly timezone: string }[]): string {
  const zone = events.at(0)?.timezone
  if (zone === undefined || !isKnownZone(zone)) return NO_EVENT_ZONE
  return zone
}

function isKnownZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * Cached per zone, for the reason `date-text.ts` gives about its own cache: building an
 * `Intl.DateTimeFormat` is the expensive part, this runs once per rendered timestamp, and a
 * memoised pure function is safe on `workerd` because a recycled isolate costs a rebuild and
 * nothing else.
 */
const ZONE_NAMES = new Map<string, Intl.DateTimeFormat>()

/**
 * What to call the clock at this instant: `PDT`, `GMT+2`, `UTC`.
 *
 * Derived from the instant rather than fixed per profile, which is the whole point of doing
 * it per row: a note written in January and a mail sent in August are `PST` and `PDT` in the
 * same zone, and one label at the top of the page would be wrong for half the list.
 *
 * The empty string when the instant or the zone is unusable, which is what leaves the
 * timestamp unannotated rather than suffixed with a lie.
 */
export function zoneAbbreviation(iso: string, timeZone: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  const existing = ZONE_NAMES.get(timeZone)
  const formatter = existing ?? createZoneNameFormatter(timeZone)
  if (formatter === undefined) return ''
  if (existing === undefined) ZONE_NAMES.set(timeZone, formatter)
  return formatter.formatToParts(parsed).find((part) => part.type === 'timeZoneName')?.value ?? ''
}

function createZoneNameFormatter(timeZone: string): Intl.DateTimeFormat | undefined {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
  } catch {
    return undefined
  }
}

/**
 * A timestamp with the clock it is on named on the same line: `Aug 10, 2026, 2:38 PM PDT`.
 *
 * Every timestamp the profile renders goes through here, and it is the half of the fix that
 * `profileTimezone` cannot do on its own. One zone makes the list readable in order; naming
 * it is what stops the next reader from having to guess, and what makes the `UTC` fallback
 * visible instead of silent. An unlabelled fallback is how a seven-hour skew shipped.
 *
 * On the value rather than in a footnote under each panel, deliberately. A footnote is a
 * per-surface opt-in and the surface that forgets it is exactly the surface this was filed
 * against; a suffix travels with the string into every panel that renders it, including
 * `SpeakerNotesPanel`, which asks for nothing but `atText`.
 *
 * The empty string in gives the empty string out, for the reason `dateTimeText` gives.
 */
export function zonedDateTimeText(iso: string | undefined, timeZone: string): string {
  if (iso === undefined) return ''
  return withZoneName(dateTimeText(iso, timeZone), iso, timeZone)
}

/** The suffix step on its own, for the two rows that arrive already formatted. */
function withZoneName(text: string, iso: string | undefined, timeZone: string): string {
  if (text === '' || iso === undefined) return text
  const name = zoneAbbreviation(iso, timeZone)
  return name === '' ? text : `${text} ${name}`
}

/**
 * Everything under the profile's Notes and Activity tab, formatted.
 *
 * ONE timezone for both lists and for the communication timeline beside them; see
 * `profileTimezone`. Neither table carries an event link (the stage is one column on the
 * person's row, and a note follows them across conferences), so there was never a per-row
 * venue zone to render these in the way the timeline once tried to.
 *
 * The zone name is added HERE rather than inside `speakerNoteRows` and `stageHistoryRows`,
 * which still own what a row IS. Both are 1:1 maps that carry the source record's id
 * through, so the annotation is matched back BY ID rather than by position, and it is
 * re-derived from the same instant and the same zone that produced the text it annotates,
 * so it cannot disagree with it.
 */
export function profileActivityRows(records: ActivityRecords, timezone: string): ProfileActivity {
  const noteAt = instantsById(records.notes)
  const changeAt = instantsById(records.changes)
  return {
    notes: speakerNoteRows(records.notes, timezone).map((row) => ({
      ...row,
      atText: withZoneName(row.atText, noteAt.get(row.id), timezone),
    })),
    stageHistory: stageHistoryRows(records.changes, timezone).map((row) => ({
      ...row,
      atText: withZoneName(row.atText, changeAt.get(row.id), timezone),
    })),
  }
}

function instantsById(
  rows: readonly { readonly id: RecordId; readonly at: string }[],
): ReadonlyMap<RecordId, string> {
  return new Map(rows.map((row) => [row.id, row.at]))
}

/**
 * The events this viewer could add the contact to: the ones they hold `admin` on, minus the
 * ones the contact is already on.
 *
 * `adminEventIds` and not `eventIds`, because linking somebody into a roster is a write and a
 * reviewer holds no such capability. The list being empty is what leaves the button off the
 * profile entirely, which is the honest rendering for a reviewer and for an organizer whose
 * every event this person is already on.
 *
 * A `getEvent` per candidate looks like the per-row fan-out `scheduler.ts` rules out and is
 * not: an organizer's membership set is a handful of events rather than a page of rows, the
 * read is a single record on `REVALIDATE.lookup`, and the context event's copy has already
 * been primed by the sidebar. It is also skipped entirely for the common case of no
 * candidates at all.
 *
 * `undefined` from a read that fails is dropped rather than fatal: an event whose record
 * cannot be read is one the picker cannot name, and a broken row must not take the profile
 * down with it.
 */
export async function loadAddableEvents(
  scope: CrmScope,
  speakerEventIds: readonly RecordId[],
): Promise<readonly AddableEvent[]> {
  const onEvent = new Set(speakerEventIds)
  const candidates = scope.adminEventIds.filter((eventId) => !onEvent.has(eventId))
  if (candidates.length === 0) return []

  const events = await Promise.all(
    candidates.map(
      async (eventId) =>
        await getEvent(eventId)
          .then((event) => ({ id: eventId, name: event.name }))
          .catch(() => undefined),
    ),
  )
  return events.filter((event): event is AddableEvent => event !== undefined)
}

/**
 * The contact's own logistics, as the read view has to show them.
 *
 * These two columns were writable from the speaker edit sheet and rendered NOWHERE, so a
 * travel note an organizer typed was invisible until somebody reopened the dialog it was
 * typed into. Surfacing them is the smaller half of the notes gap; the other half is the
 * append-only feed, which is a different thing and the panel says so.
 *
 * Both are `undefined` when unset rather than the empty string, so `Field` renders its
 * empty-cell placeholder instead of a blank line.
 */
export type ProfileLogistics = {
  readonly dietary?: string
  readonly travelNotes?: string
}

export function profileLogistics(speaker: Speaker): ProfileLogistics {
  return {
    ...(speaker.dietary === undefined ? {} : { dietary: speaker.dietary }),
    ...(speaker.travelNotes === undefined ? {} : { travelNotes: speaker.travelNotes }),
  }
}

/**
 * When the contact was last sent a portal invitation, rendered, or `undefined` if never.
 *
 * On the same card as the logistics because it answers the same question an organizer opens
 * a CRM profile to ask: what has already been done about this person. It is stored on the
 * Speakers row (`invitedAt`) and, like the two columns above it, had no read surface here.
 *
 * On the profile's one clock and named like every other timestamp on the page, so the Details
 * tab and the two feeds cannot be compared against each other and come out wrong.
 */
export function invitedAtText(speaker: Speaker, timezone: string): string | undefined {
  const text = zonedDateTimeText(speaker.invitedAt, timezone)
  return text === '' ? undefined : text
}

// The CRM profile's communication timeline: outbox rows projected into what the reader
// needs, newest first, and then rendered.
//
// It reads nothing, so `tests/crm-timeline.test.ts` asserts all of it without a base. The
// read behind it (`listOutboxForSpeaker`) already answers for ONE speaker across EVERY
// event, and its `speakerCommsTag(speakerId)` subscription is expired by all three outbox
// write paths, so the timeline is current on enqueue, on claim, on send and on failure.
//
// `TimelineRow` and `timelineRows` moved here out of `profile.ts`, which was over its size
// budget and which owns WHO THE CONTACT IS rather than how their mail reads. The rendering
// half takes the profile's clock as an argument and takes the events as a name lookup with
// the narrowest shape it can use, so nothing here has to import back out of `profile.ts`.

import type { OutboxStatus } from '@/constants/status'
import { zonedDateTimeText } from '@/features/crm/profile-activity'
import type { OutboxRow } from '@/types/domain'

export type TimelineEntry = {
  readonly id: string
  readonly subject: string
  readonly status: OutboxStatus
  /**
   * `sendAt`: when the mail was DUE to go, which is what the list is ordered on. It is not
   * when it went, and the surface says `Scheduled` over it for that reason. See below.
   */
  readonly at: string
  /**
   * `sentAt`: when it actually went, absent on every row that has not gone yet.
   *
   * Carried but never sorted on, which is the distinction the ordering rule below turns on.
   * The surface shows it beside `at` when the two render differently, so a mail queued for
   * Tuesday and delivered on Wednesday reads as both facts instead of as one ambiguous one.
   */
  readonly sentAt?: string
  readonly eventId: string
}

/**
 * What a row with no usable subject renders as.
 *
 * The parity docs cover no CRM surface (the report waives the whole area), so this is
 * authored: lower case in parentheses, matching the empty-value convention the shipped
 * admin tables already use, and it exists because `payload.subject` is a stored string
 * that a hand-edited Airtable row can leave blank. A blank line in a timeline is
 * indistinguishable from a rendering bug.
 */
const NO_SUBJECT = '(no subject)'

/**
 * The rows of one speaker's mail the viewer is entitled to see.
 *
 * `listOutboxForSpeaker` answers for a PERSON, and a person is not scoped: a speaker on
 * two organizers' conferences has both events' mail on that one Speakers row. The subject
 * lines another organizer sent are that organizer's data, so the timeline intersects with
 * the viewer's memberships the same way every other CRM read does. Without this the
 * profile would be the one CRM surface that widened scope instead of narrowing it.
 *
 * The viewer's WHOLE scope, not just the events this speaker is linked to: mail sent for
 * an event the person was later unlinked from is still the viewer's own event's mail, and
 * hiding it would make a communication log that quietly loses rows.
 */
export function scopedOutbox(
  rows: readonly OutboxRow[],
  eventIds: readonly string[],
): readonly OutboxRow[] {
  const scope = new Set(eventIds)
  return rows.filter((row) => scope.has(row.eventId))
}

/**
 * One speaker's mail, newest first.
 *
 * This doc used to sit above `scopedOutbox`, so it documented that function and this one
 * had none.
 *
 * ORDERED AND STAMPED ON `sendAt`, not on `sentAt`, and the two must be the same field:
 * only a row that actually went out has a `sentAt`, so mixing them would order a queued
 * row against a sent one on two different clocks. `sendAt` is required on every row
 * (`mapOutboxRow` reads it with `text`, never optional), so every entry has a timestamp.
 *
 * Which leaves one thing the ordering rule does not settle and this one does: `sendAt` is a
 * SCHEDULE, so a column that shows it under no label reads as a send time and is not one.
 * `sentAt` therefore rides along unsorted, and the surface labels the sorted value
 * `Scheduled` and shows `Sent` beside it when the two differ. `/email-history` takes the
 * other trade for the other reason: it is a per-event log with no queued-versus-sent
 * ordering to protect, so it sorts and shows `sentAt ?? sendAt` (`comms/log.ts`).
 *
 * Every status survives, including `failed` and `dead`. The timeline answers "what has
 * this person been sent", and mail that was promised and never arrived is the single most
 * important thing on the surface: filtering to `sent` would hide exactly the rows an
 * organizer opens this tab to find.
 *
 * Descending by string comparison, which is correct because these are ISO-8601 UTC
 * instants, the same ordering `drain.ts` relies on. `toSorted` rather than `sort`: the
 * argument is the cached read's array and mutating it would reorder a value other callers
 * share. It is also a stable sort, so two mails stamped the same minute keep the reader's
 * order rather than swapping between renders.
 */
export function speakerTimeline(rows: readonly OutboxRow[]): readonly TimelineEntry[] {
  return rows
    .map((row) => ({
      id: row.id,
      subject: subjectOf(row),
      status: row.status,
      at: row.sendAt,
      // Spread rather than assigned, because `exactOptionalPropertyTypes` refuses an
      // explicit `undefined` on an optional field.
      ...(row.sentAt === undefined ? {} : { sentAt: row.sentAt }),
      eventId: row.eventId,
    }))
    .toSorted((left, right) => right.at.localeCompare(left.at))
}

function subjectOf(row: OutboxRow): string {
  const subject = row.payload.subject.trim()
  return subject.length > 0 ? subject : NO_SUBJECT
}

/**
 * A timeline entry with the strings the surface renders beside it.
 *
 * A supertype of `TimelineEntry`, so the Communication tab still renders `TimelineEntry[]`
 * as specified. Every extra is computed on the SERVER, for the reason
 * `features/review/date-text.ts` records: the tab is a client component, and a client that
 * formatted a timestamp itself would disagree with the server whenever their timezones
 * differ, which is a hydration mismatch on a list of nothing but dates.
 */
export type TimelineRow = TimelineEntry & {
  /** Absent when the mail names an event this speaker is no longer linked to. */
  readonly eventName?: string
  /** The SCHEDULED send, which is what the list is ordered on. Labelled as such. */
  readonly atText: string
  /**
   * When it actually went, and present only when that renders differently from `atText`.
   * Absent on a row that has not gone, and on one that went out in the minute it was due,
   * which is the ordinary case: the same string twice under two labels is noise.
   */
  readonly sentAtText?: string
}

/** All `timelineRows` needs off a `ProfileEvent`, so the two files stay acyclic. */
type NamedEvent = { readonly id: string; readonly name: string }

/**
 * Timeline entries with their event's name and their timestamps already rendered.
 *
 * EVERY ROW ON ONE CLOCK, and it is the profile's, not the row's own event's. This used to
 * render each row in `byId.get(entry.eventId)?.timezone ?? 'UTC'`, which put one list under
 * as many clocks as the contact had events and silently under a third for a row whose event
 * had dropped off the profile. See `profileTimezone` for the argument and for what the eval
 * run measured; `zonedDateTimeText` names the clock on every line, so the fallback cannot
 * hide any more.
 *
 * The event lookup survives for the NAME only. An entry whose event is not in it keeps its
 * timestamp and loses its name rather than being dropped: it passed `scopedOutbox`, so it is
 * the viewer's own event's mail for an event the person has since been unlinked from.
 */
export function timelineRows(
  entries: readonly TimelineEntry[],
  events: readonly NamedEvent[],
  timezone: string,
): readonly TimelineRow[] {
  const byId = new Map(events.map((event) => [event.id, event]))
  return entries.map((entry) => {
    const atText = zonedDateTimeText(entry.at, timezone)
    const sentAtText = zonedDateTimeText(entry.sentAt, timezone)
    return {
      ...entry,
      eventName: byId.get(entry.eventId)?.name,
      atText,
      // Only when it says something `atText` does not; see `TimelineRow.sentAtText`. The
      // spread is `exactOptionalPropertyTypes`, as in `loadSpeakerProfile`.
      ...(sentAtText === '' || sentAtText === atText ? {} : { sentAtText }),
    }
  })
}

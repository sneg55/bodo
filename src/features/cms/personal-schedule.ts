// A visitor's own picks out of a public agenda: what is stored, and what is exported.
//
// AUTHORED, and the plan says so: EMB-10 is marked "inferred from category norms; not
// visible in Sessionboard", so unlike the rest of the embed there is no reference behaviour
// to clone and the decisions below are ours.
//
// STORED IN localStorage, KEYED PER EMBED. Three properties follow from that and each is a
// deliberate trade:
//
//   - It works with no account and no login, which is what the embed is for: the widgets
//     are scored on rendering fully logged out, and a star that demanded a sign-in would be
//     a worse answer to the same requirement.
//   - It is per browser and per device. A phone and a laptop do not share a schedule. That
//     is the accepted cost, and a signed-in sync was considered and rejected for the reason
//     above.
//   - A browser that partitions or clears third-party storage (Safari's ITP, Brave) can
//     drop it. Nothing here treats that as an error: a missing or unreadable value reads as
//     an empty schedule rather than raising, because an iframe that throws on load is a
//     blank rectangle on a conference's own website.
//
// Keyed per embed rather than per event because the embed is what the visitor is looking
// at, and one site can carry two of them (a full agenda and a single-track list) whose
// selections are not the same list.
//
// Everything here is pure and total: no `window`, no clock, no throwing. The component owns
// the storage calls, so all of this is testable without a DOM.

import { buildSessionCalendar, type CalendarSession } from '@/features/comms/ics'

/** One session, reduced to what an export needs. `PublicSession` satisfies it. */
export type SchedulableSession = CalendarSession

export function scheduleStorageKey(embedId: string): string {
  return `bodo:schedule:${embedId}`
}

/**
 * Parse what came out of storage.
 *
 * Tolerant by design, per the header: anything that is not an array of strings reads as an
 * empty schedule. A visitor whose stored value was corrupted gets an empty star list, not a
 * broken widget.
 *
 * Deduplicated and filtered to ids that are still in the agenda, so a session that was
 * unpublished after somebody starred it disappears from their schedule instead of
 * exporting as a VEVENT with no time.
 */
export function readSchedule(raw: string | null, known: readonly string[]): readonly string[] {
  if (raw === null || raw === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const live = new Set(known)
  const seen = new Set<string>()
  const ids: string[] = []
  // An explicit loop rather than `filter`, because the dedupe needs a side effect per kept
  // element and a predicate that mutates as it tests is the kind of clever nobody thanks you
  // for six months later.
  for (const value of parsed) {
    if (typeof value !== 'string' || !live.has(value) || seen.has(value)) continue
    seen.add(value)
    ids.push(value)
  }
  return ids
}

export function writeSchedule(ids: readonly string[]): string {
  return JSON.stringify(ids)
}

/** Star or unstar, preserving the order sessions were added in. */
export function toggleScheduled(ids: readonly string[], id: string): readonly string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
}

/**
 * The visitor's picks as an .ics document.
 *
 * A thin wrapper over `buildSessionCalendar`, which is the one PUBLISH-calendar serializer
 * (@/features/comms/ics): the embed's own `.ics` feed emits the same document from the same
 * sessions, and two builders would be two places for the escaping and the 75-octet folding to
 * drift apart. What is local to this one is the PRODID, which names the visitor's schedule
 * rather than the event's feed so a client shows them as two separate calendars.
 *
 * `dtstamp` is passed in rather than read from the clock here, so this stays pure and the
 * tests do not have to freeze time.
 */
export function buildScheduleIcs(input: {
  eventName: string
  sessions: readonly SchedulableSession[]
  dtstamp: string
}): string {
  return buildSessionCalendar({
    prodId: '-//Bodo//Personal Schedule//EN',
    calendarName: input.eventName,
    sessions: input.sessions,
    dtstamp: input.dtstamp,
  })
}

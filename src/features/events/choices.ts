// How an event is presented when it is one of several: the switcher chip and the chooser row.
//
// These two functions were private to `AdminShellSlots.tsx`, where they built the sidebar's
// event chip. They are here because the switcher modal has to draw the SAME event with the
// same avatar, the same truncated name and the same date range: the row an organizer picks IS
// the chip it turns into, and two copies of "how an event looks" would drift the first time
// either changed. The sidebar imports these now rather than owning them.
//
// Both are pure and both take the timezone explicitly, which is the property worth keeping:
// the range is formatted on the SERVER in the event's own zone and handed down as a finished
// string, so a client render cannot produce a different date than the server did. That is why
// neither returns a Date.

import type { Event, EventMembership } from '@/types/domain'

export type EventChoice = {
  readonly id: string
  /**
   * How the switcher's row ADDRESSES this event, which is its slug. `[eventId]` takes either
   * form (`src/features/events/event-ref.ts`), and the slug is chosen because this row is
   * where most sessions start: picking an event here puts the organizer on
   * `/admin/ai-engineer-worlds-fair/...` and every sidebar link keeps them there.
   *
   * Separate from `id` deliberately. `id` still drives the current-event comparison, and a
   * slug must never reach anything that builds a cache tag. See `AdminSidebarEvent`.
   */
  readonly navRef: string
  readonly name: string
  readonly initials: string
  /** The event's own logo when one has been uploaded; the initials are the fallback. */
  readonly avatarUrl?: string
  readonly dateRange: string
  readonly role: string
}

/**
 * Up to two initials from the event name, for the avatar fallback.
 *
 * Two, not three, because the sidebar chip is a fixed square and a third letter shrinks the
 * type rather than the box.
 *
 * The reference chip reads `AS` and ours reads `AE`, and the difference is the event's name
 * rather than the rule: Sessionboard's event is `AI.Engineer Sandbox`, which splits on
 * whitespace into `AI.Engineer` and `Sandbox`, while the seeded one is `AI Engineer Sandbox`,
 * which splits into three. Same function, same first-letter-of-first-two-words rule, two
 * different names. Worth knowing before anyone "fixes" this to match the screenshot.
 */
export function eventInitials(name: string): string {
  return name
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
}

/**
 * `Oct 12-14, 2026`, or `Aug 31 - Sep 5, 2026` across a month, or `Oct 12, 2026` for a
 * single day, or empty when there is no start.
 *
 * Empty rather than a placeholder: a brand new event has no dates until the organizer sets
 * them, and "TBD" in the chip would be a claim the record does not make. The sidebar simply
 * shows nothing under the name.
 *
 * **The month used to be printed once, from the start**, which was correct for the seeded
 * October event and wrong for any conference crossing a boundary: an event running August 31
 * to September 5 rendered `Aug 31-5, 2026`, a range that counts backwards and names a month
 * the second half is not in. It was visible in the sidebar chip of a real event before
 * anyone noticed, which is what a shared formatter with one caller and no test buys you. A
 * year crossing has the same shape and gets both years.
 *
 * Every part is formatted through `Intl` in the event's zone, including the year, because a
 * conference starting late on December 31st in one zone is next year in another. The parts
 * are compared as formatted strings rather than as `getMonth()` values on purpose: those
 * read in the RUNTIME's zone, so on the Worker they would answer for UTC and disagree with
 * the very text being assembled here.
 */
export function eventDateRange(
  startsAt: string | undefined,
  endsAt: string | undefined,
  timeZone: string,
): string {
  if (startsAt === undefined) return ''
  const start = parts(new Date(startsAt), timeZone)
  if (endsAt === undefined) return `${start.month} ${start.day}, ${start.year}`

  const end = parts(new Date(endsAt), timeZone)
  if (start.year !== end.year) {
    return `${start.month} ${start.day}, ${start.year} - ${end.month} ${end.day}, ${end.year}`
  }
  if (start.month !== end.month) {
    return `${start.month} ${start.day} - ${end.month} ${end.day}, ${start.year}`
  }
  return `${start.month} ${start.day}-${end.day}, ${start.year}`
}

/** One instant's month, day and year as the event's own zone renders them. */
function parts(at: Date, timeZone: string): { month: string; day: string; year: string } {
  return {
    month: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone }).format(at),
    day: new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone }).format(at),
    year: new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(at),
  }
}

/**
 * The chooser's rows: one per event, carrying the role held on it.
 *
 * Joined on the membership rather than read off the event, because role is per event
 * (`EventMemberships`) and the same person can administer one and review another. An event
 * with no matching membership is dropped rather than shown role-less: the only way to have
 * one is a read racing a revocation, and showing it would offer a door that is now shut.
 */
export function eventChoices(
  events: readonly Event[],
  memberships: readonly EventMembership[],
): readonly EventChoice[] {
  const roleByEvent = new Map(memberships.map((m) => [m.eventId, m.role]))

  return events.flatMap((event) => {
    const role = roleByEvent.get(event.id)
    if (role === undefined) return []
    return [
      {
        id: event.id,
        navRef: event.slug,
        name: event.name,
        initials: eventInitials(event.name),
        avatarUrl: event.logoUrl,
        dateRange: eventDateRange(event.startsAt, event.endsAt, event.timezone),
        role,
      },
    ]
  })
}

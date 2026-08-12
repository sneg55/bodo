// Where somebody with a role on an event should be put down.
//
// One rule, in one place, because two callers decide it and they were both getting it wrong
// in the same way: the demo sign-in buttons and the team invitation's magic link both sent
// every member to `/admin/{eventId}`.
//
// THAT ADDRESS IS THE ORGANIZER DASHBOARD. It resolves to the `(organizer)` route group,
// which a reviewer may not read, so the group's layout answered with the "Reviewer access"
// notice instead. A reviewer's landing page was therefore a card explaining that this was
// not their landing page, with a button to the one that was. Every sign-in, every time.
//
// The reviewer's queue lives under `evaluation/`, deliberately outside that route group
// (see the group's own layout), and `requireEventRole(eventId, 'reviewer')` there ranks
// `admin` above `reviewer`, so an organizer can still open it. Sending a reviewer straight
// there is the address they always wanted.
//
// Pure, so both callers can be tested without a request scope, and so this rule cannot drift
// between them.

import type { EventRole } from '@/constants/status'
import type { Event, EventMembership } from '@/types/domain'

export function adminLandingPath(eventId: string, role: EventRole): string {
  return role === 'reviewer' ? `/admin/${eventId}/evaluation` : `/admin/${eventId}`
}

/**
 * How an event's own status ranks as a landing place. Higher wins.
 *
 * An `open` event is the one taking submissions right now, a `closed` one is the conference
 * being run, and a `draft` is one nobody has opened yet.
 */
const STATUS_RANK: Record<Event['status'], number> = { open: 2, closed: 1, draft: 0 }

/** An event that no longer resolves ranks below every one that does. */
const MISSING_RANK = -1

/** The two things picking a landing event needs. `undefined` for one that cannot be read. */
export type LandingEvent = Pick<Event, 'status' | 'slug'>
export type LandingEventReader = (eventId: string) => Promise<LandingEvent | undefined>

/**
 * Where to put somebody who asked for the admin app without naming an event.
 *
 * THE RULE, in one sentence: the most recently used event, and since nothing records that,
 * the liveliest one. Concretely, memberships are ranked by
 *
 *   1. their event's status, `open` before `closed` before `draft`, then
 *   2. the membership added most recently.
 *
 * Step 1 is not a preference. `memberships.at(0)` is whatever order Airtable returned, and two
 * consecutive eval runs signed in as the organizer, landed on a near-empty DRAFT event and
 * reported the product as empty. A draft is the event nobody has opened for submissions yet,
 * so it is the last place to land rather than an arbitrary first.
 *
 * Step 2 is the honest stand-in for "most recently used": there is no last-event cookie and no
 * per-user column, so the freshest membership is the closest signal the data actually carries.
 *
 * **It is here, injected, because there are TWO doors into the admin app and they disagreed.**
 * `/admin` with no event ranked properly and addressed the winner by slug; the demo sign-in
 * buttons took `memberships.at(0)` and addressed it by record id. The demo button is the door
 * nearly everybody uses, so the entry point most likely to be seen was the one with the bug
 * this rule was written to fix, and its URLs were the unreadable ones. Neither caller may hold
 * its own copy of this.
 *
 * The destination goes through `adminLandingPath`, so a REVIEWER lands in their queue rather
 * than on the organizer dashboard that answers them with an access notice.
 *
 * `undefined` means this person holds no membership anywhere, which is a different problem at
 * each caller: a screen at `/admin`, a seeding mistake at the demo button.
 */
export async function chooseAdminLanding(
  memberships: readonly EventMembership[],
  readEvent: LandingEventReader,
): Promise<string | undefined> {
  const ranked = await Promise.all(
    memberships.map(async (membership) => ({
      membership,
      event: await readEvent(membership.eventId),
    })),
  )

  const best = ranked
    .toSorted(
      (left, right) =>
        rankOf(right.event) - rankOf(left.event) ||
        addedMs(right.membership) - addedMs(left.membership),
    )
    .at(0)

  if (best === undefined) return undefined

  // Addressed by SLUG, which is what keeps every later URL readable: the admin sidebar builds
  // its links from whatever the URL already carries (src/features/events/event-ref.ts), so
  // this one decision sets the shape of the whole session. The record id still resolves, so an
  // event whose record cannot be read falls back to it rather than losing the landing.
  return adminLandingPath(best.event?.slug ?? best.membership.eventId, best.membership.role)
}

/** A membership can outlive its event, and that must cost it the landing rather than throw. */
function rankOf(event: LandingEvent | undefined): number {
  return event === undefined ? MISSING_RANK : STATUS_RANK[event.status]
}

/** `0` for an unparseable timestamp, so one bad row cannot make the comparator return NaN. */
function addedMs(membership: EventMembership): number {
  const at = Date.parse(membership.addedAt)
  return Number.isNaN(at) ? 0 : at
}

// Who the request is acting as, for the admin chrome to show back to them.
//
// The top bar hardcoded `Organizer` / `OR` / no email, so a reviewer signed into their own
// queue was told they were the organizer while the Evaluation page's role chip next to it
// correctly said `reviewer`. The identity was always available on the server; nothing was
// reading it.
//
// It is NOT read off the session token. The cookie carries a user id and nothing else, and
// that is deliberate (guards.ts): a name baked into a 30 day JWT would keep showing the old
// one after the person edited it, and putting anything role-shaped in there is the mistake
// `requireEventRole` exists to prevent. So the id comes from the session and everything
// displayed comes from the event's own member list.
//
// `readTeamMembers` rather than a new AdminUsers-by-id read: it is the same cached, tagged
// pair the Event Team page and the committee picker already issue (`event:{id}`), so on an
// admin page it is usually a cache hit rather than a second Airtable round trip, and it
// answers for a reviewer as well as an admin. `features/bundle/request.ts` looks the acting
// user's address up exactly this way.
//
// Total by construction. The chrome renders on every admin page and an identity nobody can
// resolve must not be the thing that takes the page down, so a missing session, a missing
// membership row and a failed read all resolve to the same anonymous chip.

import { isAppError } from '@/constants/errorIds'
import { requireAdminUser } from '@/features/auth/wiring'
import { readTeamMembers } from '@/features/team/reads'

export type ActingUser = {
  /** Never blank. The email when the AdminUsers row has no name yet. */
  readonly name: string
  /** Blank only when the row could not be resolved at all. */
  readonly email: string
  /** One or two letters for the avatar fallback. Never blank. */
  readonly initials: string
}

/** What the top bar shows when the acting user cannot be resolved. */
const UNKNOWN: ActingUser = { name: 'Signed in', email: '', initials: '?' }

/**
 * Up to two letters, from the first two words of the name, or the first letter of the
 * address when there is no name.
 *
 * Two and not three, for the reason `eventInitials` gives about the event chip: the avatar
 * is a fixed circle and a third letter shrinks the type rather than the circle. Kept here
 * rather than shared with that function because an event name and a person's name are
 * different things that happen to be abbreviated the same way today.
 */
export function actingInitials(name: string, email: string): string {
  const letters = name
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
  if (letters !== '') return letters
  return email.charAt(0).toUpperCase() || UNKNOWN.initials
}

/** The three strings the chrome shows, from a member row. Pure, so it is testable. */
export function actingUserOf(member: { name: string; email: string }): ActingUser {
  const name = member.name.trim()
  return {
    name: name === '' ? member.email : name,
    email: member.email,
    initials: actingInitials(name, member.email),
  }
}

/**
 * The acting user's display identity on this event.
 *
 * Deliberately NOT awaited by the caller: `AdminShellSlots` hands the promise to the client
 * top bar, which resolves it inside its own Suspense boundary, so nothing above waits on
 * Airtable for a name. See BUILD_SPEC 6.1.
 */
export async function actingUser(eventId: string): Promise<ActingUser> {
  try {
    const { userId } = await requireAdminUser()
    const member = (await readTeamMembers(eventId)).find((row) => row.userId === userId)
    return member === undefined ? UNKNOWN : actingUserOf(member)
  } catch (error) {
    // Only our own failures, never a bare catch: Next signals control flow by THROWING,
    // and swallowing a redirect or a prerender postpone here would strand the request.
    // Same narrowing as the layout's `currentRole`.
    if (isAppError(error)) return UNKNOWN
    throw error
  }
}

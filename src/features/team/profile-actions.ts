'use server'

// Save the acting user's own display name.
//
// THE AUTHORIZATION IS THE WHOLE DESIGN, and it is why this action takes no `eventId`. The
// only row it may write is the one the SESSION names, so there is no id from the client to
// resolve, no event to be an admin of, and nothing a crafted POST can point somewhere else.
// `requireAdminUser()` is the entire check: hold a session that resolves to an `AdminUsers`
// row, edit that row's name. A reviewer may do it as well as an admin, deliberately, since
// the rows that read "No name yet" on the team table are mostly invited reviewers.
//
// The event ids exist only for invalidation. `readEventTeam` is tagged per event
// (`reads-team.ts`), so a rename has to expire every event this person appears on or their
// old name survives on the other teams for the full hour window. They come from the user's
// own memberships rather than from the caller for the same reason as above.

import { requireAdminUser } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { checkProfileName, normalizeProfileName } from '@/features/team/profile'
import { refuse } from '@/features/team/team-write-guards'
import { updateAdminUserName } from '@/services/airtable/mutations-team'
import { listMembershipsForUser } from '@/services/airtable/queries'

/**
 * Store the name, and hand back the value that was actually written.
 *
 * The stored form is returned rather than assumed, matching `saveEventDetailsAction` and
 * the Event Team writes: the field is normalized on the way in, so a client that kept what
 * was typed would show a name the base does not have.
 */
export async function saveProfileNameAction(input: {
  name: string
}): Promise<ActionResult<{ name: string }>> {
  try {
    const { userId } = await requireAdminUser()

    const problem = checkProfileName(input.name)
    if (problem !== undefined) throw refuse(problem.message, { userId })

    // The CAPABILITY lookup, which is cached and tagged `user:{id}:memberships`. Cached is
    // right here even though this is a write path: nothing branches on the answer, it is
    // only the set of tags to expire, and the failure direction of a stale entry is an
    // event whose team page keeps the old name until its own window lapses.
    const memberships = await listMembershipsForUser(userId)

    const name = normalizeProfileName(input.name)
    await updateAdminUserName({
      userId,
      name,
      eventIds: memberships.map((membership) => membership.eventId),
    })

    return actionOk({ name })
  } catch (error) {
    return actionFailure(error)
  }
}

'use server'

// The three Server Actions behind the Event Team page.
//
// Thin on purpose. Everything that can be got wrong lives in ./team-write.ts, which takes the
// guard and the DAL as arguments so the refuse-before-writing order is testable
// (tests/team-authorization.test.ts); this file is the one place that resolves those
// arguments, in the same shape as `features/comms/template-actions.ts`.
//
// `requireEventRole(eventId, 'admin')` is wired in HERE and not relied on from
// `(admin)/admin/[eventId]/layout.tsx`. BUILD_SPEC 4 is why in general, and this surface is
// the sharpest case of it: an action is reachable by POST with no layout ever rendering, and
// what these three write is the row that grants capability on every subsequent request.
//
// Failures come back as values rather than thrown, matching the rest of the admin actions: a
// thrown AppError crossing the action boundary reaches the browser as a redacted digest, and
// "that address is already on this team" is something the organizer can act on.

import type { EventRole } from '@/constants/status'
import { adminLandingPath } from '@/features/auth/landing'
import { requestMagicLink } from '@/features/auth/magic-link'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { teamInviteEmail } from '@/features/team/invite-email'
import type { TeamMember } from '@/features/team/members'
import { readTeamMembersForWrite } from '@/features/team/reads'
import {
  addTeamMember,
  changeTeamRole,
  removeTeamMember,
  resendTeamInvite,
  type TeamWriteDeps,
} from '@/features/team/team-write'
import {
  createAdminUser,
  createEventMembership,
  deleteEventMembership,
  updateMembershipRole,
} from '@/services/airtable/mutations-team'
import { findAdminUserByEmail, getEvent } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

/**
 * Resolved per call rather than once at module scope. Not style: a module-level object closing
 * over anything request-shaped is exactly the long-lived isolate state the Workers rules
 * forbid, and these are only function references, so building them per call costs nothing.
 */
function deps(): TeamWriteDeps {
  return {
    requireAdmin: async (eventId) => await requireEventRole(eventId, 'admin'),
    // The UNCACHED read. It is what the duplicate refusal and the last-admin rule branch on.
    listTeam: readTeamMembersForWrite,
    findUserByEmail: findAdminUserByEmail,
    createUser: createAdminUser,
    createMembership: createEventMembership,
    updateRole: updateMembershipRole,
    removeMembership: deleteEventMembership,
    invite: sendTeamInvite,
    nowIso: () => new Date().toISOString(),
  }
}

/**
 * The magic-link invite BUILD_SPEC 5.0b asks for, landing on the event they were added to.
 *
 * `resolveSubject` is a constant here rather than `resolveLoginSubject`, and that is the
 * honest wiring rather than a shortcut: the `AdminUsers` row was just created or just found by
 * the caller, so its id is known, and going back through an uncached lookup by address would
 * be a second request for an answer already in hand. It is not a weakening either, because
 * this path is reached only after `requireEventRole(eventId, 'admin')` and after the row
 * exists. `resolve-subject.ts` refuses to CREATE an account during login for the reason stated
 * there, and nothing here is a login.
 *
 * `compose` is what makes this an INVITATION rather than a sign-in link. Without it the
 * message was the generic "Use this link to sign in", so a reviewer added to a committee got
 * an unexplained credential for a product they had never heard of, naming neither the event
 * nor the role. The event name costs one CACHED read (`getEvent`), which the admin chrome
 * around the Team page has already issued, and a failure to resolve it cannot take the
 * invitation down: `addTeamMember` treats the whole send as best effort.
 */
async function sendTeamInvite(input: {
  eventId: RecordId
  userId: RecordId
  email: string
  role: EventRole
}): Promise<{ delivered: boolean }> {
  const event = await getEvent(input.eventId)

  const { delivered } = await requestMagicLink({
    email: input.email,
    audience: 'admin',
    nowMs: Date.now(),
    resolveSubject: () => Promise.resolve({ kind: 'user', userId: input.userId }),
    // Per ROLE. `/admin/{id}` is the organizer dashboard, so an invited reviewer following
    // their own invitation used to arrive on the "Reviewer access" refusal card: the very
    // first thing the product ever showed them was a notice that this was not their screen.
    redirectTo: adminLandingPath(input.eventId, input.role),
    compose: (url) => teamInviteEmail({ eventName: event.name, role: input.role, url }),
  })
  return { delivered }
}

export async function addTeamMemberAction(input: {
  eventId: RecordId
  email: string
  role: string
}): Promise<ActionResult<{ member: TeamMember; invited: boolean }>> {
  try {
    return actionOk(await addTeamMember(deps(), input))
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Send the sign-in link again. The counterpart to `addTeamMemberAction` reporting
 * `invited: false`: without this, an organizer who saw that had no way to try again short
 * of removing the person and adding them back.
 */
export async function resendTeamInviteAction(input: {
  eventId: RecordId
  membershipId: RecordId
}): Promise<ActionResult<{ member: TeamMember; invited: boolean }>> {
  try {
    return actionOk(await resendTeamInvite(deps(), input))
  } catch (error) {
    return actionFailure(error)
  }
}

export async function changeTeamRoleAction(input: {
  eventId: RecordId
  membershipId: RecordId
  role: string
}): Promise<ActionResult<{ member: TeamMember }>> {
  try {
    return actionOk(await changeTeamRole(deps(), input))
  } catch (error) {
    return actionFailure(error)
  }
}

export async function removeTeamMemberAction(input: {
  eventId: RecordId
  membershipId: RecordId
}): Promise<ActionResult<{ membershipId: RecordId }>> {
  try {
    return actionOk(await removeTeamMember(deps(), input))
  } catch (error) {
    return actionFailure(error)
  }
}

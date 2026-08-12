// The three Event Team writes, with their authorization in front of them.
//
// AUTHORIZATION IS THE WHOLE RISK ON THIS SURFACE. A row in `EventMemberships` is what
// grants capability everywhere else in this app: `requireEventRole` resolves it from that
// table on every request, so a write here can hand somebody the event. Every other admin
// surface can at worst corrupt data.
//
// Dependencies are arguments, in the same shape and for the same stated reason as
// `features/comms/template-write.ts`: the property that matters is an ORDER (refuse before
// reading, and certainly before writing), and an implementation that reached for
// `requireEventRole` and the DAL itself could only be checked by driving a real session
// through a real base. `./team-actions.ts` is the one place that resolves these arguments,
// and tests/team-authorization.test.ts drives the functions below against the REAL guard
// from `features/auth/guards.ts` with a stub membership loader.
//
// Four rules, and the first three are the security ones:
//
//   1. `requireAdmin` runs FIRST, before anything is read. It is `requireEventRole(eventId,
//      'admin')`, so it refuses in one call: a reviewer on this event (holding a role is not
//      permission to grant one), an admin of a DIFFERENT event, a caller with no membership,
//      an unauthenticated caller, and an IMPERSONATED session. That last one falls out of
//      `requireAdminUser` checking `kind`: impersonation works by acting as a speaker
//      session (features/auth/impersonation.ts), so its `kind` is `speaker` and no admin
//      capability opens up on it, whoever it claims to have started as.
//   2. THE EVENT IN THE URL SCOPES THE WRITE. A `membershipId` arriving in an action is
//      client input, so it is looked up in the AUTHORIZED event's own list before it is
//      touched. Without that, an admin of event A could change a role on event B by posting
//      B's record id, and the role check would have passed. This is the same re-read that
//      `features/settings/lookup-actions.ts` does before renaming a Tag.
//   3. THE ROLE COMES FROM `EVENT_ROLES`, never from the client string. An unrecognised
//      value written into the select column is a membership whose role `mapMembership`
//      refuses to map, which breaks the guard for that user on every request.
//   4. The last admin cannot be removed or demoted (`checkLastAdmin`). That is a product
//      decision with its reasoning recorded next to the rule in ./members.ts.

import type { EventRole } from '@/constants/status'
import {
  checkLastAdmin,
  checkNewMemberEmail,
  normalizeEmail,
  type TeamMember,
  teamRows,
} from '@/features/team/members'
import { assertOnEvent, assertRole, refuse } from '@/features/team/team-write-guards'
import type { AdminUser, EventMembership, RecordId } from '@/types/domain'

export type TeamWriteDeps = {
  /**
   * `requireEventRole(eventId, 'admin')`, returning the acting user. Raises; it never
   * returns a boolean. The acting id is returned because a refusal wants it in the log line
   * and because "you are editing your own row" is a thing the caller reports back.
   */
  requireAdmin: (eventId: RecordId) => Promise<{ userId: RecordId }>
  /**
   * The event's own memberships joined to their people. UNCACHED at the call site: this is
   * what decides create-versus-refuse, and a cached miss is how one person ends up with two
   * membership rows on one event (read-cache.ts states the rule; `listEmailTemplatesUncached`
   * is the same decision for the same reason).
   */
  listTeam: (eventId: RecordId) => Promise<readonly TeamMember[]>
  /** Uncached lookup by address, so an account created seconds ago is found. */
  findUserByEmail: (email: string) => Promise<AdminUser | undefined>
  /** Creates the `AdminUsers` row when the address has none. Returns its record id. */
  createUser: (input: { eventId: RecordId; email: string }) => Promise<RecordId>
  createMembership: (input: {
    eventId: RecordId
    userId: RecordId
    role: EventRole
    addedAt: string
  }) => Promise<EventMembership>
  updateRole: (input: {
    membershipId: RecordId
    eventId: RecordId
    userId: RecordId
    role: EventRole
  }) => Promise<void>
  removeMembership: (input: {
    membershipId: RecordId
    eventId: RecordId
    userId: RecordId
  }) => Promise<void>
  /**
   * The magic-link invite BUILD_SPEC 5.0b asks for. Best effort by design: see
   * `addTeamMember` on why a failed send does not undo the membership.
   *
   * `role` is passed for the COPY, not for any decision made here: the message names what
   * the person was made, because a bare sign-in link for an unnamed product is
   * indistinguishable from phishing (`features/team/invite-email.ts`). It is the role
   * actually written or actually held, never the one the client asked for.
   */
  invite: (input: {
    eventId: RecordId
    userId: RecordId
    email: string
    role: EventRole
  }) => Promise<{ delivered: boolean }>
  /** The instant stamped on `addedAt`. Injected so the written row is assertable. */
  nowIso: () => string
}

export type AddTeamMemberInput = {
  eventId: RecordId
  email: string
  /** Client input. Checked against `EVENT_ROLES`. */
  role: string
}

export type AddedTeamMember = {
  member: TeamMember
  /** False when the invite could not be sent, or when no email provider is configured. */
  invited: boolean
}

/**
 * Add somebody to the event's team by email address.
 *
 * Creating the `AdminUsers` row here is the one place in the product that may do it, and
 * that is deliberate: `resolve-subject.ts` refuses to create one during login, because an
 * address that could mint its own account would let anybody hand themselves an admin
 * session. It is safe here precisely because an existing admin of this event authorized it.
 *
 * The INVITE is best effort and is reported rather than enforced. The membership is the
 * capability; the mail is a convenience, and `sendEmail` deliberately does not throw when no
 * provider is configured (services/email/send.ts). Rolling the membership back on a send
 * failure would be worse than reporting it: the organizer would see nothing added and try
 * again, and the person can always ask for a fresh link from the login page.
 */
export async function addTeamMember(
  deps: TeamWriteDeps,
  input: AddTeamMemberInput,
): Promise<AddedTeamMember> {
  // Rule 1. Before the role is looked at and before anything is read.
  await deps.requireAdmin(input.eventId)
  const role = assertRole(input.role, input.eventId)

  const existing = await deps.listTeam(input.eventId)
  const problem = checkNewMemberEmail(input.email, existing)
  if (problem !== undefined) throw refuse(problem.message, { eventId: input.eventId })

  const email = normalizeEmail(input.email)
  const found = await deps.findUserByEmail(email)
  const userId = found?.id ?? (await deps.createUser({ eventId: input.eventId, email }))

  const membership = await deps.createMembership({
    eventId: input.eventId,
    userId,
    role,
    addedAt: deps.nowIso(),
  })

  const invited = await sendInvite(deps, { eventId: input.eventId, userId, email, role })
  const member = rowOf(membership, { id: userId, email, name: found?.name ?? '' })
  return { member, invited }
}

export type ResendInviteInput = {
  eventId: RecordId
  /** Client input. Resolved against the authorized event's own list. */
  membershipId: RecordId
}

/**
 * Send the sign-in link again to somebody who is already on the team.
 *
 * `addTeamMember` treats the invite as best effort and reports `invited: false` rather than
 * rolling the membership back, which is the right call and leaves one thing missing: the
 * organizer who saw that message had no way to try again short of removing the person and
 * adding them back. A reviewer provisioned during an eval run was therefore on the team with
 * no route to a working sign-in, which is the difference between "provisioned" and
 * "provisioned with usable credentials".
 *
 * The address comes from the ROW rather than the client, for the same reason the role change
 * takes its `userId` from the row: the only thing a caller may name is a membership on the
 * event they were just authorized as an admin of. That also keeps this from being a way to
 * mint a link for an arbitrary account.
 */
export async function resendTeamInvite(
  deps: TeamWriteDeps,
  input: ResendInviteInput,
): Promise<{ member: TeamMember; invited: boolean }> {
  await deps.requireAdmin(input.eventId)

  const rows = await deps.listTeam(input.eventId)
  const target = assertOnEvent(rows, input)

  const invited = await sendInvite(deps, {
    eventId: input.eventId,
    userId: target.userId,
    email: target.email,
    // From the ROW, like the address beside it: the resent invitation must describe the
    // role the person holds now, not the one they were originally given.
    role: target.role,
  })
  return { member: target, invited }
}

export type ChangeTeamRoleInput = {
  eventId: RecordId
  /** Client input. Resolved against the authorized event's own list. */
  membershipId: RecordId
  role: string
}

/**
 * Change one member's role.
 *
 * The `userId` written to the invalidation comes from the ROW, never from the client, so the
 * capability cache expired is the one belonging to the person whose role actually changed.
 */
export async function changeTeamRole(
  deps: TeamWriteDeps,
  input: ChangeTeamRoleInput,
): Promise<{ member: TeamMember }> {
  await deps.requireAdmin(input.eventId)
  const role = assertRole(input.role, input.eventId)

  const rows = await deps.listTeam(input.eventId)
  const target = assertOnEvent(rows, input)

  const lockout = checkLastAdmin(rows, input.membershipId, role)
  if (lockout !== undefined) throw refuse(lockout.message, input)

  await deps.updateRole({
    membershipId: target.membershipId,
    eventId: input.eventId,
    userId: target.userId,
    role,
  })
  return { member: { ...target, role } }
}

export type RemoveTeamMemberInput = { eventId: RecordId; membershipId: RecordId }

/** Remove a membership. The person's `AdminUsers` row is left alone: see ./team-actions.ts. */
export async function removeTeamMember(
  deps: TeamWriteDeps,
  input: RemoveTeamMemberInput,
): Promise<{ membershipId: RecordId }> {
  await deps.requireAdmin(input.eventId)

  const rows = await deps.listTeam(input.eventId)
  const target = assertOnEvent(rows, input)

  const lockout = checkLastAdmin(rows, input.membershipId)
  if (lockout !== undefined) throw refuse(lockout.message, input)

  await deps.removeMembership({
    membershipId: target.membershipId,
    eventId: input.eventId,
    userId: target.userId,
  })
  return { membershipId: target.membershipId }
}

async function sendInvite(
  deps: TeamWriteDeps,
  input: { eventId: RecordId; userId: RecordId; email: string; role: EventRole },
): Promise<boolean> {
  try {
    return (await deps.invite(input)).delivered
  } catch {
    // Swallowed on purpose, and reported as `invited: false`. See `addTeamMember`.
    return false
  }
}

function rowOf(membership: EventMembership, user: AdminUser): TeamMember {
  // Built through `teamRows` rather than assembled here, so the row handed back to the UI
  // cannot drift from the row the next page read produces.
  const [row] = teamRows({
    memberships: [membership],
    users: [user],
    eventId: membership.eventId,
  })
  return row
}

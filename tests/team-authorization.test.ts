// Who may edit an event's team.
//
// This is the highest-stakes authorization test in the codebase, because a row in
// `EventMemberships` IS the capability everywhere else: `requireEventRole` resolves it from
// that table on every request, so a write that authorizes wrongly hands somebody the event
// rather than merely corrupting a record.
//
// Every refusal here runs the REAL guard (`tests/helpers/team-fakes.ts` binds
// `requireEventRole` from `src/features/auth/guards.ts` to a stub membership loader). That is
// the point of the exercise and not a convenience: a test that asserts against its own copy
// of the role rule proves nothing about the rule the app enforces. Same arrangement as
// tests/comms-template-authorization.test.ts.
//
// The assertions that matter are not "it throws". They are that NOTHING WAS WRITTEN, and for
// a refused role that nothing was even READ, because a guard that runs after the write is
// decoration. Input validation and the lockout rule live in tests/team-write.test.ts.

import { describe, expect, it } from 'vitest'

import {
  addTeamMember,
  changeTeamRole,
  removeTeamMember,
  resendTeamInvite,
} from '@/features/team/team-write'

import { errorIdOf, IMPERSONATED, membershipRow, SPEAKER } from './helpers/auth-fakes'
import { EVENT_A, EVENT_B, REVIEWER, TEAM_A, teamGuard, teamSpyDeps } from './helpers/team-fakes'

const ADD = { eventId: EVENT_A, email: 'new@example.com', role: 'admin' }
const CHANGE = { eventId: EVENT_A, membershipId: 'recMemA2', role: 'admin' }
const REMOVE = { eventId: EVENT_A, membershipId: 'recMemA2' }

describe('addTeamMember authorization', () => {
  it('lets an admin of the event add a member, creating the AdminUsers row and inviting', async () => {
    const { deps, writes, invites } = teamSpyDeps(teamGuard(TEAM_A))

    const added = await addTeamMember(deps, ADD)

    expect(writes).toEqual([
      'createUser:recEventA:new@example.com',
      'createMembership:recEventA:recUserNew:admin',
    ])
    expect(added.member).toMatchObject({
      membershipId: 'recMemNew',
      email: 'new@example.com',
      role: 'admin',
    })
    expect(invites).toEqual(['new@example.com:recUserNew:admin'])
  })

  it('refuses a REVIEWER on the event, and writes and reads nothing', async () => {
    // Holding a role on an event is not permission to grant one, and `roleSatisfies` ranks
    // `reviewer` below `admin`, so this is the guard's own answer.
    const { deps, writes, reads } = teamSpyDeps(teamGuard(TEAM_A, REVIEWER))

    expect(await errorIdOf(() => addTeamMember(deps, ADD))).toBe('E_AUTH_005')
    expect(writes).toEqual([])
    // Refused before it read anything, which is what "authorize first" means.
    expect(reads).toEqual([])
  })

  it('refuses a reviewer adding THEMSELVES as an admin of the event', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A, REVIEWER))

    expect(
      await errorIdOf(() =>
        addTeamMember(deps, { eventId: EVENT_A, email: 'rae@example.com', role: 'admin' }),
      ),
    ).toBe('E_AUTH_005')
    expect(writes).toEqual([])
  })

  it('refuses an admin of a DIFFERENT event, and writes nothing', async () => {
    const { deps, writes, reads } = teamSpyDeps(teamGuard([membershipRow(EVENT_B, 'admin')]))

    expect(await errorIdOf(() => addTeamMember(deps, ADD))).toBe('E_AUTH_005')
    expect(writes).toEqual([])
    expect(reads).toEqual([])
  })

  it('refuses a caller with no membership at all', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard([]))

    expect(await errorIdOf(() => addTeamMember(deps, ADD))).toBe('E_AUTH_005')
    expect(writes).toEqual([])
  })

  it('refuses a request carrying no session', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A, null))

    expect(await errorIdOf(() => addTeamMember(deps, ADD))).toBe('E_AUTH_004')
    expect(writes).toEqual([])
  })

  it('refuses a plain speaker session even where an admin holds the same record id', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A, SPEAKER))

    expect(await errorIdOf(() => addTeamMember(deps, ADD))).toBe('E_AUTH_005')
    expect(writes).toEqual([])
  })

  it('refuses an IMPERSONATED session outright, even though its impersonator is an admin', async () => {
    // `IMPERSONATED` names recUser1, who really does hold `admin` on EVENT_A in `TEAM_A`. It
    // is still refused, because impersonation works by acting as a SPEAKER session
    // (features/auth/impersonation.ts): `requireAdminUser` checks `kind`, and the
    // `impersonatorUserId` claim is never consulted for capability. Without this property,
    // "View Portal" would be a route to granting yourself a membership while appearing to be
    // a speaker, and the log would show the speaker doing it.
    const { deps, writes, reads } = teamSpyDeps(teamGuard(TEAM_A, IMPERSONATED))

    expect(await errorIdOf(() => addTeamMember(deps, ADD))).toBe('E_AUTH_005')
    expect(writes).toEqual([])
    expect(reads).toEqual([])
  })
})

describe('changeTeamRole authorization and scoping', () => {
  it('lets an admin change a role, and writes the row own user id', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A))

    const changed = await changeTeamRole(deps, CHANGE)

    // The user id comes from the ROW, never from the client, so the capability cache that
    // gets expired belongs to the person whose role actually changed.
    expect(writes).toEqual(['updateRole:recMemA2:recEventA:recUser2:admin'])
    expect(changed.member.role).toBe('admin')
  })

  it('refuses a REVIEWER, and writes nothing', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A, REVIEWER))

    expect(await errorIdOf(() => changeTeamRole(deps, CHANGE))).toBe('E_AUTH_005')
    expect(writes).toEqual([])
  })

  it('refuses an IMPERSONATED session, and writes nothing', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A, IMPERSONATED))

    expect(await errorIdOf(() => changeTeamRole(deps, CHANGE))).toBe('E_AUTH_005')
    expect(writes).toEqual([])
  })

  it("refuses an admin of event B editing event A's membership row", async () => {
    // The ROLE check passes here, for EVENT_B, so this is the SCOPE check doing the work: a
    // membership id is client input, and this one belongs to another event's team. Answered
    // as not-found rather than forbidden, so an admin cannot use it to discover that a
    // record id is a live membership somewhere else.
    const { deps, writes } = teamSpyDeps(teamGuard([membershipRow(EVENT_B, 'admin')]), {
      team: TEAM_A,
    })

    expect(
      await errorIdOf(() =>
        changeTeamRole(deps, { eventId: EVENT_B, membershipId: 'recMemA1', role: 'reviewer' }),
      ),
    ).toBe('E_DATA_001')
    expect(writes).toEqual([])
  })
})

describe('resendTeamInvite authorization and scoping', () => {
  it('sends to the address on the ROW, and writes nothing', async () => {
    const { deps, writes, invites } = teamSpyDeps(teamGuard(TEAM_A))

    const result = await resendTeamInvite(deps, REMOVE)

    // The address is never taken from the caller, so this cannot be used to mint a sign-in
    // link for an account that is not on the authorized event's team. The ROLE comes off the
    // same row, so the resent invitation describes what this person holds now: `recUser2` is
    // a reviewer on event A, and `REMOVE` names nothing but a membership id.
    expect(invites).toEqual(['rae@example.com:recUser2:reviewer'])
    expect(result.invited).toBe(true)
    expect(writes).toEqual([])
  })

  it('refuses a REVIEWER, and sends nothing', async () => {
    const { deps, invites } = teamSpyDeps(teamGuard(TEAM_A, REVIEWER))

    expect(await errorIdOf(() => resendTeamInvite(deps, REMOVE))).toBe('E_AUTH_005')
    expect(invites).toEqual([])
  })

  it('refuses an IMPERSONATED session, and sends nothing', async () => {
    const { deps, invites } = teamSpyDeps(teamGuard(TEAM_A, IMPERSONATED))

    expect(await errorIdOf(() => resendTeamInvite(deps, REMOVE))).toBe('E_AUTH_005')
    expect(invites).toEqual([])
  })

  it("refuses an admin of event B resending on event A's membership row", async () => {
    // The scope check, as in changeTeamRole: minting a link for another event's member is
    // exactly the escalation that check exists to stop.
    const { deps, invites } = teamSpyDeps(teamGuard([membershipRow(EVENT_B, 'admin')]), {
      team: TEAM_A,
    })

    expect(
      await errorIdOf(() => resendTeamInvite(deps, { eventId: EVENT_B, membershipId: 'recMemA1' })),
    ).toBe('E_DATA_001')
    expect(invites).toEqual([])
  })

  it('reports a send failure rather than raising', async () => {
    // The membership already exists, so a provider outage is not a reason to fail the call.
    const { deps } = teamSpyDeps(teamGuard(TEAM_A), { inviteFails: true })

    expect((await resendTeamInvite(deps, REMOVE)).invited).toBe(false)
  })
})

describe('removeTeamMember authorization and scoping', () => {
  it('lets an admin remove a reviewer', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A))

    await removeTeamMember(deps, REMOVE)

    expect(writes).toEqual(['remove:recMemA2:recEventA:recUser2'])
  })

  it('refuses a REVIEWER removing anybody, and writes nothing', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A, REVIEWER))

    expect(
      await errorIdOf(() => removeTeamMember(deps, { eventId: EVENT_A, membershipId: 'recMemA1' })),
    ).toBe('E_AUTH_005')
    expect(writes).toEqual([])
  })

  it('refuses an IMPERSONATED session, and writes nothing', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A, IMPERSONATED))

    expect(await errorIdOf(() => removeTeamMember(deps, REMOVE))).toBe('E_AUTH_005')
    expect(writes).toEqual([])
  })

  it("refuses removing another event's membership row", async () => {
    const { deps, writes } = teamSpyDeps(teamGuard([membershipRow(EVENT_B, 'admin')]), {
      team: TEAM_A,
    })

    expect(
      await errorIdOf(() => removeTeamMember(deps, { eventId: EVENT_B, membershipId: 'recMemA2' })),
    ).toBe('E_DATA_001')
    expect(writes).toEqual([])
  })
})

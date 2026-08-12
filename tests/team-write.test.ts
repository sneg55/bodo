// What the Event Team writes do with their input once the caller is authorized.
//
// Split from tests/team-authorization.test.ts, which is about WHO may write. This file is
// about what an authorized admin is still not allowed to do, and each case is a row that
// would otherwise reach Airtable and break something quietly:
//
//   - a role string the select column does not have, which makes `mapMembership` refuse the
//     row and therefore breaks that person's capability on every request;
//   - a second membership for somebody who already has one, which the base accepts because
//     there is no unique constraint;
//   - the removal or demotion of the last admin, which leaves an event nobody can manage;
//   - a failed invite, which must not undo a membership that was created.
//
// The guard is real here too (`teamGuard`), so an authorized case is authorized by the app's
// own rule rather than by a stub that always says yes.

import { describe, expect, it } from 'vitest'

import { addTeamMember, changeTeamRole, removeTeamMember } from '@/features/team/team-write'
import type { EventMembership } from '@/types/domain'

import { errorIdOf, membershipRow } from './helpers/auth-fakes'
import { EVENT_A, EVENT_B, TEAM_A, TEAM_NOW, teamGuard, teamSpyDeps } from './helpers/team-fakes'

const ADD = { eventId: EVENT_A, email: 'new@example.com', role: 'admin' }

describe('addTeamMember input handling', () => {
  it('stamps addedAt from the injected clock rather than reading one', async () => {
    const { deps } = teamSpyDeps(teamGuard(TEAM_A))

    const added = await addTeamMember(deps, ADD)

    expect(added.member.addedAt).toBe(TEAM_NOW)
  })

  it('refuses a role that is not one of EVENT_ROLES, before reading anything', async () => {
    const { deps, writes, reads } = teamSpyDeps(teamGuard(TEAM_A))

    expect(await errorIdOf(() => addTeamMember(deps, { ...ADD, role: 'owner' }))).toBe('E_DATA_003')
    expect(writes).toEqual([])
    expect(reads).toEqual([])
  })

  it('refuses an address that already has a membership on this event', async () => {
    // Airtable has no unique constraint, so the duplicate WOULD be created, and the guard
    // would then resolve to whichever of the two rows paginated back first.
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A))

    expect(await errorIdOf(() => addTeamMember(deps, { ...ADD, email: 'SAM@example.com' }))).toBe(
      'E_DATA_003',
    )
    expect(writes).toEqual([])
  })

  it('refuses a malformed address before it creates an account for it', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A))

    expect(await errorIdOf(() => addTeamMember(deps, { ...ADD, email: 'sam@example' }))).toBe(
      'E_DATA_003',
    )
    expect(writes).toEqual([])
  })

  it('reuses an existing AdminUsers row rather than creating a second one', async () => {
    // rae@example.com has an AdminUsers row, and no membership on EVENT_B.
    const { deps, writes } = teamSpyDeps(teamGuard([membershipRow(EVENT_B, 'admin')]), { team: [] })

    await addTeamMember(deps, { eventId: EVENT_B, email: 'rae@example.com', role: 'reviewer' })

    expect(writes).toEqual(['createMembership:recEventB:recUser2:reviewer'])
  })

  it('normalizes the address it stores and invites', async () => {
    const { deps, writes, invites } = teamSpyDeps(teamGuard(TEAM_A))

    await addTeamMember(deps, { ...ADD, email: '  New@Example.COM ' })

    expect(writes).toContain('createUser:recEventA:new@example.com')
    expect(invites).toEqual(['new@example.com:recUserNew:admin'])
  })

  it('still adds the member when the invite cannot be sent, and reports it', async () => {
    // The membership is the capability; the mail is a convenience, and `sendEmail` does not
    // even throw when no provider is configured. Rolling the membership back would leave the
    // organizer seeing nothing added.
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A), { inviteFails: true })

    const added = await addTeamMember(deps, ADD)

    expect(added.invited).toBe(false)
    expect(writes).toContain('createMembership:recEventA:recUserNew:admin')
  })
})

describe('the last admin cannot be locked out', () => {
  const twoAdmins: readonly EventMembership[] = [TEAM_A[0], { ...TEAM_A[1], role: 'admin' }]

  it('refuses demoting the only admin', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A))

    expect(
      await errorIdOf(() =>
        changeTeamRole(deps, { eventId: EVENT_A, membershipId: 'recMemA1', role: 'reviewer' }),
      ),
    ).toBe('E_DATA_003')
    expect(writes).toEqual([])
  })

  it('refuses the admin removing their OWN last admin membership', async () => {
    // The decision, enforced: recUser1 is the only admin on EVENT_A, and a reviewer cannot
    // open this page, so the event would have nobody able to repair it. See ./members.ts.
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A))

    expect(
      await errorIdOf(() => removeTeamMember(deps, { eventId: EVENT_A, membershipId: 'recMemA1' })),
    ).toBe('E_DATA_003')
    expect(writes).toEqual([])
  })

  it('allows re-saving the only admin as admin, which changes nothing', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A))

    await changeTeamRole(deps, { eventId: EVENT_A, membershipId: 'recMemA1', role: 'admin' })

    expect(writes).toEqual(['updateRole:recMemA1:recEventA:recUser1:admin'])
  })

  it('allows removing an admin once a second admin exists', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(twoAdmins), { team: twoAdmins })

    await removeTeamMember(deps, { eventId: EVENT_A, membershipId: 'recMemA1' })

    expect(writes).toEqual(['remove:recMemA1:recEventA:recUser1'])
  })

  it('allows demoting an admin once a second admin exists', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(twoAdmins), { team: twoAdmins })

    await changeTeamRole(deps, { eventId: EVENT_A, membershipId: 'recMemA1', role: 'reviewer' })

    expect(writes).toEqual(['updateRole:recMemA1:recEventA:recUser1:reviewer'])
  })

  it('says nothing about removing a reviewer, whatever the admin count is', async () => {
    const { deps, writes } = teamSpyDeps(teamGuard(TEAM_A))

    await removeTeamMember(deps, { eventId: EVENT_A, membershipId: 'recMemA2' })

    expect(writes).toEqual(['remove:recMemA2:recEventA:recUser2'])
  })
})

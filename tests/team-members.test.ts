// The Event Team's rules, away from Airtable and away from React.
//
// Three of them are worth a test each, and each one is a bug that would only show up as a
// broken event:
//
//   1. The JOIN. `EventMemberships` carries the role and `AdminUsers` carries the person, so
//      the table is a join, and it has to be scoped to the event in the URL. A row from
//      another event appearing here is the same class of mistake as an unscoped write.
//   2. The DUPLICATE refusal. Airtable has no unique constraint, so two membership rows for
//      one person on one event is representable, and `requireEventRole` would then find
//      whichever the pagination returned first. Following the Tags precedent
//      (`checkLookupName` in features/settings/lookups.ts), the check is pure and here.
//   3. The LAST ADMIN. Removing or demoting the only admin leaves an event nobody can
//      manage and no surface in this build can repair, so it is refused. See the note on
//      `checkLastAdmin` for why refusing beats allowing plus a warning.

import { describe, expect, it } from 'vitest'

import {
  checkLastAdmin,
  checkNewMemberEmail,
  formatAddedAt,
  isEmailLike,
  normalizeEmail,
  type TeamMember,
  teamRoleLabel,
  teamRows,
} from '@/features/team/members'
import type { AdminUser, EventMembership } from '@/types/domain'

const EVENT_A = 'recEventA'
const EVENT_B = 'recEventB'
const ADDED_AT = '2026-02-01T00:00:00.000Z'

function membership(input: {
  id: string
  userId: string
  role: 'admin' | 'reviewer'
  eventId?: string
}): EventMembership {
  return {
    id: input.id,
    eventId: input.eventId ?? EVENT_A,
    userId: input.userId,
    role: input.role,
    addedAt: ADDED_AT,
  }
}

const USERS: readonly AdminUser[] = [
  { id: 'recUser1', email: 'sam@example.com', name: 'Sam Organizer' },
  { id: 'recUser2', email: 'rae@example.com', name: 'Rae Reviewer' },
  { id: 'recUser3', email: 'kim@example.com', name: '' },
]

function rows(memberships: readonly EventMembership[]): readonly TeamMember[] {
  return teamRows({ memberships, users: USERS, eventId: EVENT_A })
}

describe('teamRows', () => {
  it('joins the person onto the membership that carries the role', () => {
    const built = rows([membership({ id: 'recM1', userId: 'recUser1', role: 'admin' })])

    expect(built).toEqual([
      {
        membershipId: 'recM1',
        userId: 'recUser1',
        name: 'Sam Organizer',
        email: 'sam@example.com',
        role: 'admin',
        addedAt: ADDED_AT,
      },
    ])
  })

  it('keeps only the memberships on the event asked for', () => {
    const built = rows([
      membership({ id: 'recM1', userId: 'recUser1', role: 'admin' }),
      membership({ id: 'recM2', userId: 'recUser2', role: 'reviewer', eventId: EVENT_B }),
    ])

    expect(built.map((row) => row.membershipId)).toEqual(['recM1'])
  })

  it('sorts by name, and falls back to the email when a person has no name', () => {
    const built = rows([
      membership({ id: 'recM3', userId: 'recUser3', role: 'reviewer' }),
      membership({ id: 'recM1', userId: 'recUser1', role: 'admin' }),
      membership({ id: 'recM2', userId: 'recUser2', role: 'reviewer' }),
    ])

    // recUser3 has a blank name, so it sorts under `kim@example.com`.
    expect(built.map((row) => row.email)).toEqual([
      'kim@example.com',
      'rae@example.com',
      'sam@example.com',
    ])
  })

  it('KEEPS a membership whose AdminUsers row is gone, so it can be removed from here', () => {
    // Deliberately not dropped. A row pointing at a deleted person still grants a role on
    // every request (`listMembershipsForUser` reads the membership, not the user), so hiding
    // it would hide live capability, and it would also let `checkNewMemberEmail` miss a
    // duplicate. It renders as an unknown member and the Remove action clears it.
    const built = rows([membership({ id: 'recM9', userId: 'recGone', role: 'admin' })])

    expect(built).toEqual([
      {
        membershipId: 'recM9',
        userId: 'recGone',
        name: '',
        email: '',
        role: 'admin',
        addedAt: ADDED_AT,
      },
    ])
  })
})

describe('formatAddedAt and teamRoleLabel', () => {
  it('renders the audit stamp in UTC, so it does not shift with the reader', () => {
    expect(formatAddedAt('2026-02-01T23:30:00.000Z')).toBe('Feb 1, 2026')
  })

  it('renders a blank or unparseable stamp as a dash rather than Invalid Date', () => {
    // A row added directly in the Airtable grid can have an empty column.
    expect(formatAddedAt('')).toBe('-')
    expect(formatAddedAt('whenever')).toBe('-')
  })

  it('spells the two roles once, for the select and for every message', () => {
    expect([teamRoleLabel('admin'), teamRoleLabel('reviewer')]).toEqual(['Admin', 'Reviewer'])
  })
})

describe('normalizeEmail and isEmailLike', () => {
  it('trims and lowercases, because that is what the duplicate check compares', () => {
    expect(normalizeEmail('  Sam@Example.COM ')).toBe('sam@example.com')
  })

  it('accepts an ordinary address and refuses the shapes a typo produces', () => {
    expect(isEmailLike('sam@example.com')).toBe(true)
    expect(isEmailLike('sam.o+tag@sub.example.co.uk')).toBe(true)
    expect(isEmailLike('sam')).toBe(false)
    expect(isEmailLike('sam@')).toBe(false)
    expect(isEmailLike('@example.com')).toBe(false)
    expect(isEmailLike('sam@example')).toBe(false)
    expect(isEmailLike('sam@@example.com')).toBe(false)
    expect(isEmailLike('sam @example.com')).toBe(false)
    expect(isEmailLike('sam@exa mple.com')).toBe(false)
    expect(isEmailLike('sam@example..com')).toBe(false)
  })
})

describe('checkNewMemberEmail', () => {
  const existing = rows([
    membership({ id: 'recM1', userId: 'recUser1', role: 'admin' }),
    membership({ id: 'recM2', userId: 'recUser2', role: 'reviewer' }),
  ])

  it('accepts an address nobody on the team holds', () => {
    expect(checkNewMemberEmail('new@example.com', existing)).toBeUndefined()
  })

  it('requires an address', () => {
    expect(checkNewMemberEmail('   ', existing)?.message).toBe('Email address is required.')
  })

  it('refuses something that is not an address', () => {
    expect(checkNewMemberEmail('sam', existing)?.message).toContain('not an email address')
  })

  it('refuses an address already on the team, whatever case it is typed in', () => {
    // The refusal, not a second row: Airtable would accept the duplicate and
    // `requireEventRole` would then resolve to whichever row came back first.
    expect(checkNewMemberEmail('SAM@example.com ', existing)?.message).toBe(
      'sam@example.com is already on this team.',
    )
  })

  it('refuses an address longer than the column should hold', () => {
    const long = `${'a'.repeat(250)}@example.com`

    expect(checkNewMemberEmail(long, existing)?.message).toContain('too long')
  })
})

describe('checkLastAdmin', () => {
  const soleAdmin = rows([
    membership({ id: 'recM1', userId: 'recUser1', role: 'admin' }),
    membership({ id: 'recM2', userId: 'recUser2', role: 'reviewer' }),
  ])
  const twoAdmins = rows([
    membership({ id: 'recM1', userId: 'recUser1', role: 'admin' }),
    membership({ id: 'recM2', userId: 'recUser2', role: 'admin' }),
  ])

  it('refuses REMOVING the only admin', () => {
    expect(checkLastAdmin(soleAdmin, 'recM1')?.message).toContain('only admin')
  })

  it('refuses DEMOTING the only admin to reviewer', () => {
    // The same lockout by a different route: a reviewer cannot open this page, so an event
    // whose last admin demoted themselves has no way back through the product.
    expect(checkLastAdmin(soleAdmin, 'recM1', 'reviewer')?.message).toContain('only admin')
  })

  it('allows demoting an admin while another admin remains', () => {
    expect(checkLastAdmin(twoAdmins, 'recM1', 'reviewer')).toBeUndefined()
  })

  it('allows removing an admin while another admin remains', () => {
    expect(checkLastAdmin(twoAdmins, 'recM1')).toBeUndefined()
  })

  it('allows re-saving the only admin as admin, which changes nothing', () => {
    expect(checkLastAdmin(soleAdmin, 'recM1', 'admin')).toBeUndefined()
  })

  it('allows removing a reviewer regardless of how many admins there are', () => {
    expect(checkLastAdmin(soleAdmin, 'recM2')).toBeUndefined()
  })

  it('says nothing about a membership that is not on the list', () => {
    // Ownership is a separate check with its own error id; this rule only counts admins.
    expect(checkLastAdmin(soleAdmin, 'recNope')).toBeUndefined()
  })
})

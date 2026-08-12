// The member picker's pure half.
//
// The picker is the control the form builder's two admin-recipient fields need
// (`Forms.adminAlertOnNew` and `adminAlertOnUpdate`, BUILD_SPEC 5.3), and those columns hold
// EMAIL ADDRESSES. That is the source of every case below: the value is free text, so it can
// hold an address belonging to nobody on the team, the same mailbox in two different cases,
// or a member who was removed after the form was saved. All three have to survive a round
// trip through the control without changing what the event sends mail to.
//
// No DOM here: vitest runs `environment: 'node'` and the component is a thin shell over
// these functions precisely so the rules are testable without one.

import { describe, expect, it } from 'vitest'

import type { TeamMember } from '@/features/team/members'
import {
  addTypedRecipient,
  normalizeRecipients,
  recipientChips,
  recipientOptions,
  removeRecipient,
  toggleRecipient,
} from '@/features/team/recipients'

function member(input: {
  id: string
  email: string
  name?: string
  role?: 'admin' | 'reviewer'
}): TeamMember {
  return {
    membershipId: `recM-${input.id}`,
    userId: input.id,
    name: input.name ?? '',
    email: input.email,
    role: input.role ?? 'admin',
    addedAt: '2026-02-01T00:00:00.000Z',
  }
}

const TEAM: readonly TeamMember[] = [
  member({ id: 'recUser1', email: 'Sam@Example.com', name: 'Sam Organizer' }),
  member({ id: 'recUser2', email: 'rae@example.com', name: 'Rae Reviewer', role: 'reviewer' }),
  member({ id: 'recUser3', email: 'kim@example.com' }),
]

const OPTIONS = recipientOptions(TEAM)

describe('recipientOptions', () => {
  it('normalizes the addresses, since that is what the value is compared on', () => {
    expect(OPTIONS.map((option) => option.email)).toEqual([
      'sam@example.com',
      'rae@example.com',
      'kim@example.com',
    ])
  })

  it('drops a member whose AdminUsers row is gone, because a blank address sends nothing', () => {
    // `teamRows` keeps that row on the team page so the role can be revoked. It is not a
    // recipient, so it is dropped here rather than there.
    const options = recipientOptions([...TEAM, member({ id: 'recGone', email: '' })])

    expect(options).toHaveLength(3)
  })

  it('keeps one option per mailbox when two members share an address', () => {
    const options = recipientOptions([
      ...TEAM,
      member({ id: 'recDupe', email: 'SAM@EXAMPLE.COM', name: 'Sam Again' }),
    ])

    expect(options.filter((option) => option.email === 'sam@example.com')).toHaveLength(1)
  })
})

describe('recipientChips', () => {
  it('labels a stored member address with the member name', () => {
    expect(recipientChips(['sam@example.com'], OPTIONS)).toEqual([
      { email: 'sam@example.com', label: 'Sam Organizer', kind: 'member' },
    ])
  })

  it('falls back to the address when the member has no name', () => {
    expect(recipientChips(['kim@example.com'], OPTIONS)).toEqual([
      { email: 'kim@example.com', label: 'kim@example.com', kind: 'member' },
    ])
  })

  it('marks an address that belongs to nobody on the team as EXTERNAL, and keeps it', () => {
    // The case the column legitimately holds: an alias, or a colleague with no admin
    // account. Dropping it would silently stop an alert the organizer configured.
    expect(recipientChips(['cfp@conference.example'], OPTIONS)).toEqual([
      { email: 'cfp@conference.example', label: 'cfp@conference.example', kind: 'external' },
    ])
  })

  it('matches a stored address against the team case-insensitively', () => {
    expect(recipientChips(['  SAM@Example.COM '], OPTIONS)[0]).toMatchObject({
      kind: 'member',
      email: 'sam@example.com',
    })
  })

  it('collapses the same mailbox stored twice, so one alert is not sent twice', () => {
    expect(recipientChips(['sam@example.com', 'SAM@example.com'], OPTIONS)).toHaveLength(1)
  })

  it('drops a blank entry, which is what a trailing comma in the column leaves behind', () => {
    expect(recipientChips(['', '   ', 'sam@example.com'], OPTIONS)).toHaveLength(1)
  })

  it('preserves the stored order rather than the team order', () => {
    const chips = recipientChips(['rae@example.com', 'sam@example.com'], OPTIONS)

    expect(chips.map((chip) => chip.email)).toEqual(['rae@example.com', 'sam@example.com'])
  })
})

describe('normalizeRecipients', () => {
  it('is what the control emits: normalized, de-duplicated, in order', () => {
    expect(normalizeRecipients([' A@b.com', 'a@B.com', '', 'c@d.com'])).toEqual([
      'a@b.com',
      'c@d.com',
    ])
  })
})

describe('toggleRecipient and removeRecipient', () => {
  it('adds a member that was not selected', () => {
    expect(toggleRecipient(['sam@example.com'], 'rae@example.com')).toEqual([
      'sam@example.com',
      'rae@example.com',
    ])
  })

  it('removes a member that was already selected, whatever case it is stored in', () => {
    expect(toggleRecipient(['SAM@example.com', 'rae@example.com'], 'sam@example.com')).toEqual([
      'rae@example.com',
    ])
  })

  it('removes an external address by its chip', () => {
    expect(removeRecipient(['sam@example.com', 'cfp@x.example'], 'cfp@x.example')).toEqual([
      'sam@example.com',
    ])
  })

  it('leaves the list alone when removing something that is not in it', () => {
    expect(removeRecipient(['sam@example.com'], 'nobody@x.example')).toEqual(['sam@example.com'])
  })
})

describe('addTypedRecipient', () => {
  it('accepts an address that belongs to nobody on the team', () => {
    expect(addTypedRecipient(['sam@example.com'], ' CFP@Conference.example ')).toEqual({
      ok: true,
      value: ['sam@example.com', 'cfp@conference.example'],
    })
  })

  it('REFUSES a malformed address rather than dropping it quietly', () => {
    // Discovered otherwise when the alert never arrives.
    const result = addTypedRecipient([], 'not-an-address')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toContain('not an email address')
  })

  it('refuses an empty entry', () => {
    expect(addTypedRecipient([], '   ').ok).toBe(false)
  })

  it('is idempotent for an address already in the list', () => {
    expect(addTypedRecipient(['cfp@x.example'], 'CFP@X.example')).toEqual({
      ok: true,
      value: ['cfp@x.example'],
    })
  })
})

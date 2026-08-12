// The admin chrome's identity chip: the two letters and the two lines under them.
//
// Pure half only. The read around it is one `find` over the cached team list; what is worth
// pinning is that a member row with no name still produces something to show, because the
// hardcoded `Organizer` / `OR` it replaces never had that problem and a blank avatar circle
// reads as a broken image.

import { describe, expect, it } from 'vitest'

import { actingInitials, actingUserOf } from '@/features/auth/acting-user'

describe('actingInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(actingInitials('Ada Lovelace', 'ada@example.com')).toBe('AL')
  })

  it('stops at two letters', () => {
    expect(actingInitials('Ada Byron Lovelace', 'ada@example.com')).toBe('AB')
  })

  it('falls back to the email when there is no name', () => {
    expect(actingInitials('', 'ada@example.com')).toBe('A')
  })

  it('is never blank', () => {
    expect(actingInitials('', '')).toBe('?')
  })
})

describe('actingUserOf', () => {
  it('shows the name, the address and the initials', () => {
    expect(actingUserOf({ name: 'Ada Lovelace', email: 'ada@example.com' })).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      initials: 'AL',
    })
  })

  it('shows the address as the name when the AdminUsers row has none', () => {
    expect(actingUserOf({ name: '  ', email: 'ada@example.com' })).toEqual({
      name: 'ada@example.com',
      email: 'ada@example.com',
      initials: 'A',
    })
  })
})

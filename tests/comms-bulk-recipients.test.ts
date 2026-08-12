// Who a bulk send resolves to. SPK-13.
//
// The rules that matter here are all ways a bulk control quietly does the wrong thing rather
// than failing: mailing somebody the organizer did not select, mailing one mailbox twice, or
// dropping people without saying so.

import { describe, expect, it } from 'vitest'

import { greetingName, resolveBulkRecipients } from '@/features/comms/bulk-recipients'
import type { Speaker } from '@/types/domain'

function speaker(overrides: Partial<Speaker> & Pick<Speaker, 'id'>): Speaker {
  return {
    email: `${overrides.id}@example.com`,
    firstName: 'Ada',
    lastName: 'Lovelace',
    // Required on `Speaker`; empty is its resting state. Spread last so a case can override it.
    links: {},
    ...overrides,
  }
}

const ada = speaker({ id: 'recAda', firstName: 'Ada', email: 'ada@example.com' })
const grace = speaker({ id: 'recGrace', firstName: 'Grace', email: 'grace@example.com' })

describe('resolveBulkRecipients', () => {
  it('treats the ids as a filter over the roster, never as a recipient list', () => {
    // The whole authorization argument: an id that is not on this event resolves to nobody.
    const result = resolveBulkRecipients([ada, grace], ['recAda', 'recStranger'])

    expect(result.recipients.map((row) => row.email)).toEqual(['ada@example.com'])
    expect(result.unknownIds).toBe(1)
  })

  it('resolves to nobody when nothing is selected', () => {
    // An empty selection quietly meaning "the whole roster" is how eighty people get an
    // email nobody chose.
    expect(resolveBulkRecipients([ada, grace], []).recipients).toEqual([])
  })

  it('keeps roster order rather than selection order', () => {
    // A preview whose first recipient changes because the boxes were ticked in a different
    // sequence reads as a bug in the merge fields.
    const result = resolveBulkRecipients([ada, grace], ['recGrace', 'recAda'])

    expect(result.recipients.map((row) => row.speakerId)).toEqual(['recAda', 'recGrace'])
  })

  it('collapses one mailbox to one message and counts the collapse', () => {
    const duplicate = speaker({ id: 'recAda2', email: '  ADA@example.com ' })
    const result = resolveBulkRecipients([ada, duplicate], ['recAda', 'recAda2'])

    expect(result.recipients).toHaveLength(1)
    expect(result.skippedDuplicate).toBe(1)
  })

  it('skips a speaker with no address and counts them, rather than failing the batch', () => {
    const nameOnly = speaker({ id: 'recNoMail', email: '   ' })
    const result = resolveBulkRecipients([ada, nameOnly], ['recAda', 'recNoMail'])

    expect(result.recipients).toHaveLength(1)
    expect(result.skippedNoEmail).toBe(1)
    expect(result.unknownIds).toBe(0)
  })

  it('mails the address as stored, not the lowercased comparison key', () => {
    const mixed = speaker({ id: 'recMixed', email: ' Ada.Lovelace@Example.com ' })
    const [row] = resolveBulkRecipients([mixed], ['recMixed']).recipients

    expect(row.email).toBe('Ada.Lovelace@Example.com')
  })

  it('does not report a phantom stranger when one id is sent twice', () => {
    expect(resolveBulkRecipients([ada], ['recAda', 'recAda']).unknownIds).toBe(0)
  })
})

describe('greetingName', () => {
  const base = { speakerId: 'recAda', email: 'ada@example.com' }

  it('prefers the first name', () => {
    expect(greetingName({ ...base, firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada')
  })

  it('falls back to the last name, then to a word that is never empty', () => {
    // An empty merge value is one `renderTemplate` treats as unsupplied, and it throws, so a
    // nameless row imported from a spreadsheet would take the whole batch down.
    expect(greetingName({ ...base, firstName: '  ', lastName: 'Lovelace' })).toBe('Lovelace')
    expect(greetingName({ ...base, firstName: '', lastName: '' })).toBe('there')
  })
})

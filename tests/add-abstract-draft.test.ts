// `+ ADD PARTICIPANT` must not block the form it just added a row to.
//
// The defect, from the eval run of 2026-08-10: "'+ ADD PARTICIPANT' inserts a blank
// 'Participant 2' panel that is visually indistinguishable from a real second speaker and
// blocks submission with 'Participants: Email is required for every participant' until it is
// manually removed via a small close icon." Pressing a button to add somebody and then being
// refused for not having added them yet is the control arguing with itself.
//
// Both halves are pinned, because fixing only the first would be worse than the defect: an
// untouched panel that no longer blocks the form must also not be SENT, or it reaches
// `upsertSpeakerByEmail` and creates a nameless speaker with an empty address.

import { describe, expect, it } from 'vitest'

import {
  type ExtraParticipant,
  isBlankExtra,
  missingFromAbstractDraft,
  toManualAbstractInput,
} from '@/app/(admin)/admin/[eventId]/(organizer)/abstracts/add-abstract-draft'

const DRAFT = {
  title: 'Taming 40-Minute CI',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Okafor',
  status: 'accepted' as const,
  description: '',
  capacity: '',
  ceuCredits: '',
  clientSessionId: '',
  format: '',
  startsAt: '',
  endsAt: '',
}

function extra(over: Partial<ExtraParticipant> = {}): ExtraParticipant {
  return { key: 'k1', email: '', firstName: '', lastName: '', ...over }
}

describe('isBlankExtra', () => {
  it('is true for a panel nobody has typed into', () => {
    expect(isBlankExtra(extra())).toBe(true)
  })

  it('is true when the fields hold only whitespace', () => {
    expect(isBlankExtra(extra({ email: '  ', firstName: ' ', lastName: '\t' }))).toBe(true)
  })

  it('is false once ANY field is filled, so a half-entered person still counts', () => {
    expect(isBlankExtra(extra({ firstName: 'Marcus' }))).toBe(false)
    expect(isBlankExtra(extra({ email: 'm@example.com' }))).toBe(false)
  })
})

describe('missingFromAbstractDraft', () => {
  it('does not block on an untouched panel', () => {
    expect(missingFromAbstractDraft(DRAFT, [extra()])).toEqual([])
  })

  it('still blocks on a panel with a name and no email', () => {
    // Half-entered is a real attempt, and an upsert keys on the address, so this one has to
    // be completed or removed.
    expect(missingFromAbstractDraft(DRAFT, [extra({ firstName: 'Marcus' })])).toContain(
      'Participants: Email is required for every participant.',
    )
  })

  it('reports the missing email once however many panels are half-entered', () => {
    const problems = missingFromAbstractDraft(DRAFT, [
      extra({ key: 'k1', firstName: 'Marcus' }),
      extra({ key: 'k2', lastName: 'Webb' }),
    ])

    expect(problems.filter((entry) => entry.includes('every participant'))).toHaveLength(1)
  })

  it('still reports the primary speaker separately', () => {
    expect(missingFromAbstractDraft({ ...DRAFT, email: '' }, [extra()])).toEqual([
      'Participants: Email is required for the primary speaker.',
    ])
  })
})

describe('toManualAbstractInput', () => {
  it('drops an untouched panel rather than upserting a nameless speaker', () => {
    const input = toManualAbstractInput('recEvt1', DRAFT, [extra()])

    expect(input.participants).toHaveLength(1)
    expect(input.participants.at(0)?.email).toBe('ada@example.com')
  })

  it('keeps a real co-speaker', () => {
    const input = toManualAbstractInput('recEvt1', DRAFT, [
      extra({ email: 'marcus@example.com', firstName: 'Marcus' }),
    ])

    expect(input.participants.map((entry) => entry.email)).toEqual([
      'ada@example.com',
      'marcus@example.com',
    ])
  })

  it('keeps the primary first, because that is who becomes Submissions.submitter', () => {
    const input = toManualAbstractInput('recEvt1', DRAFT, [
      extra(),
      extra({ key: 'k2', email: 'marcus@example.com' }),
    ])

    expect(input.participants.at(0)?.email).toBe('ada@example.com')
    expect(input.participants).toHaveLength(2)
  })
})

// Enrolling a contact into a sourcing stage: who the control offers, and what the enrollment
// records beyond the move.
//
// Separate from `crm-pipeline.test.ts`, which pins the GROUPING rule. This is the forward
// action the board did not have: every contact is auto-placed into Prospect, so an agent
// enumerating the board's controls found no enroll, add-prospect or add-card action anywhere,
// and being drawn in a column by default is not an organizer having put somebody there.

import { describe, expect, it } from 'vitest'
import type { SpeakerStatus } from '@/constants/status'
import { ENROLL_SCORES, enrollmentNote, RATIONALE_MAX } from '@/features/crm/enroll'
import { enrollableContacts } from '@/features/crm/pipeline'
import type { CrmScope } from '@/features/crm/scope'
import type { SpeakerInEvents } from '@/types/crm'

const SCOPE: CrmScope = {
  userId: 'usr1',
  eventIds: ['e1', 'e2'],
  adminEventIds: ['e1'],
  contextEventId: 'e1',
}

/** A viewer who reads both events and can write on neither. */
const REVIEWER: CrmScope = { ...SCOPE, adminEventIds: [] }

const contact = (
  id: string,
  status?: SpeakerStatus,
  eventIds: readonly string[] = ['e1'],
  extra: { tagline?: string; company?: string } = {},
): SpeakerInEvents => ({
  speaker: {
    id,
    email: `${id}@example.com`,
    firstName: 'Ada',
    lastName: id,
    links: {},
    ...(status === undefined ? {} : { status }),
    ...extra,
  },
  eventIds: [...eventIds],
})

describe('enrollableContacts', () => {
  it('offers every contact the viewer holds admin over', () => {
    const offered = enrollableContacts(SCOPE, [contact('a'), contact('b')])
    expect(offered.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('leaves out a contact on an event the viewer only reads', () => {
    // `editableEventId` is the same rule the card's Move-to menu and the action both apply.
    const offered = enrollableContacts(SCOPE, [contact('a', undefined, ['e2'])])
    expect(offered).toEqual([])
  })

  it('offers nobody to a reviewer, which is what hides the control', () => {
    expect(enrollableContacts(REVIEWER, [contact('a'), contact('b')])).toEqual([])
  })

  it('shows the stage they are FILED under, not the one stored', () => {
    // A contact whose column was never written is drawn in Prospect, so the picker has to say
    // Prospect too or it disagrees with the column the card is sitting in.
    const offered = enrollableContacts(SCOPE, [contact('a'), contact('b', 'invited')])
    expect(offered.map((entry) => entry.stage)).toEqual(['prospect', 'invited'])
  })

  it('carries a subtitle that is never blank', () => {
    const offered = enrollableContacts(SCOPE, [
      contact('a', undefined, ['e1'], { tagline: 'Head of Platform' }),
      contact('b'),
    ])
    expect(offered.map((entry) => entry.subtitle)).toEqual(['Head of Platform', 'b@example.com'])
  })

  it('is not capped the way a board column is', () => {
    // A picker that silently omitted the person being searched for would answer "no contacts"
    // about somebody plainly in the directory. See `enrollableContacts`.
    const many = Array.from({ length: 120 }, (_, index) => contact(`c${String(index)}`))
    expect(enrollableContacts(SCOPE, many)).toHaveLength(120)
  })
})

describe('enrollmentNote', () => {
  it('writes no note when neither optional field was filled in', () => {
    // Both are bonus. An empty note would be refused by `checkNoteBody` and would turn a
    // successful enrollment into an error about a field left deliberately blank.
    expect(enrollmentNote({ stage: 'prospect' })).toBeUndefined()
    expect(enrollmentNote({ stage: 'prospect', rationale: '   ' })).toBeUndefined()
  })

  it('names the stage, so the note still says something months later', () => {
    expect(enrollmentNote({ stage: 'invited', rationale: 'Ran the platform track.' })).toBe(
      'Enrolled in Invited. Ran the platform track.',
    )
  })

  it('carries the score when one was given', () => {
    expect(enrollmentNote({ stage: 'prospect', score: 4 })).toBe(
      'Enrolled in Prospect. Fit score 4/5.',
    )
    expect(enrollmentNote({ stage: 'prospect', score: 4, rationale: 'Strong draw.' })).toBe(
      'Enrolled in Prospect. Fit score 4/5. Strong draw.',
    )
  })

  it('drops a score outside the offered range rather than refusing the enrollment', () => {
    // Unreachable from the dialog; a hand-built POST is the only way here, and losing the
    // number is a better trade than losing the rationale beside it.
    expect(enrollmentNote({ stage: 'prospect', score: 99, rationale: 'Keep this.' })).toBe(
      'Enrolled in Prospect. Keep this.',
    )
    expect(enrollmentNote({ stage: 'prospect', score: 0 })).toBeUndefined()
  })

  it('accepts every score the dialog offers', () => {
    for (const score of ENROLL_SCORES) {
      expect(enrollmentNote({ stage: 'prospect', score })).toContain(`Fit score ${String(score)}/5`)
    }
  })

  it('bounds the rationale rather than sending an unbounded note to the write layer', () => {
    const note = enrollmentNote({ stage: 'prospect', rationale: 'x'.repeat(RATIONALE_MAX + 500) })
    expect(note).toContain('x'.repeat(RATIONALE_MAX))
    expect(note).not.toContain('x'.repeat(RATIONALE_MAX + 1))
  })
})

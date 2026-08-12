// The payload boundary, plus the two pieces of shared client/server mapping that sit
// just behind it.
//
// The public submit is an open POST: the wizard is one client and anything that can
// reach the Server Action is another. So the shape is parsed rather than trusted, and a
// payload that is not the shape this feature works with is an AppError with an id rather
// than a Problem, because it did not come from a control anyone can be told about.

import { describe, expect, it } from 'vitest'

import { ErrorIds, isAppError } from '@/constants/errorIds'
import {
  identityFieldIds,
  speakerDraftFor,
  withIdentityAnswers,
} from '@/features/submissions/participants'
import { parseSubmitPayload } from '@/features/submissions/payload'
import type { FormField } from '@/types/forms'

const VALID = {
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Okafor',
  answers: { f_title: 'Agents that ship' },
  participants: [
    {
      key: 'p1',
      role: 'speaker',
      isPrimary: true,
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Okafor',
      answers: {},
    },
  ],
}

function errorIdOf(input: unknown): string | undefined {
  try {
    parseSubmitPayload(input)
    return undefined
  } catch (error) {
    return isAppError(error) ? error.id : undefined
  }
}

describe('parseSubmitPayload', () => {
  it('accepts the shape the wizard sends', () => {
    expect(parseSubmitPayload(VALID).participants[0].role).toBe('speaker')
  })

  it('accepts every answer value type a field can produce', () => {
    const parsed = parseSubmitPayload({
      ...VALID,
      answers: { a: 'text', b: ['one', 'two'], c: true, d: 12, e: null },
    })
    expect(parsed.answers.b).toEqual(['one', 'two'])
    expect(parsed.answers.c).toBe(true)
  })

  it('rejects a payload that is not an object', () => {
    expect(errorIdOf('nope')).toBe(ErrorIds.SUB_VALIDATION_FAIL)
    expect(errorIdOf(null)).toBe(ErrorIds.SUB_VALIDATION_FAIL)
    expect(errorIdOf([])).toBe(ErrorIds.SUB_VALIDATION_FAIL)
  })

  it('rejects answers sent as anything but a keyed object', () => {
    expect(errorIdOf({ ...VALID, answers: 'title=x' })).toBe(ErrorIds.SUB_VALIDATION_FAIL)
    expect(errorIdOf({ ...VALID, answers: ['x'] })).toBe(ErrorIds.SUB_VALIDATION_FAIL)
  })

  it('rejects a participant role outside the vocabulary', () => {
    expect(
      errorIdOf({ ...VALID, participants: [{ ...VALID.participants[0], role: 'keynote' }] }),
    ).toBe(ErrorIds.SUB_VALIDATION_FAIL)
  })

  it('rejects an absurd number of participants before anything validates them', () => {
    const many = Array.from({ length: 50 }, (_unused, index) => ({
      ...VALID.participants[0],
      key: `p${index}`,
    }))
    expect(errorIdOf({ ...VALID, participants: many })).toBe(ErrorIds.SUB_VALIDATION_FAIL)
  })

  it('rejects an absurd number of answer keys', () => {
    const answers = Object.fromEntries(
      Array.from({ length: 500 }, (_unused, index) => [`f${index}`, 'x']),
    )
    expect(errorIdOf({ ...VALID, answers })).toBe(ErrorIds.SUB_VALIDATION_FAIL)
  })
})

describe('participant identity mapping', () => {
  const registryFields: readonly FormField[] = [
    { id: 'a', type: 'text', label: 'Given name', required: true, registryKey: 'firstName' },
    { id: 'b', type: 'text', label: 'Family name', required: true, registryKey: 'lastName' },
    { id: 'c', type: 'email', label: 'Work email', required: true, registryKey: 'email' },
    { id: 'd', type: 'text', label: 'Company', required: false, registryKey: 'company' },
  ]

  it('resolves identity fields from their registry keys', () => {
    const ids = identityFieldIds(registryFields)
    expect([ids.get('firstName'), ids.get('lastName'), ids.get('email')]).toEqual(['a', 'b', 'c'])
  })

  it('falls back to type and label when a form carries no registry keys', () => {
    // A hand-authored fieldsJson. This is a presentation decision (do not ask for the
    // same value twice), never a storage one, so a wrong guess duplicates a control
    // rather than misfiling an answer.
    const ids = identityFieldIds([
      { id: 'x', type: 'text', label: 'First Name', required: true },
      { id: 'y', type: 'text', label: 'Last Name', required: true },
      { id: 'z', type: 'email', label: 'Email', required: true },
    ])
    expect([ids.get('firstName'), ids.get('lastName'), ids.get('email')]).toEqual(['x', 'y', 'z'])
  })

  it('fills the identity answers back in so a locked required question is satisfied', () => {
    const answers = withIdentityAnswers({
      fields: registryFields,
      identity: { email: 'ada@example.com', firstName: 'Ada', lastName: 'Okafor' },
      answers: { d: 'Northwind AI' },
    })
    expect(answers).toEqual({ a: 'Ada', b: 'Okafor', c: 'ada@example.com', d: 'Northwind AI' })
  })

  it('maps the non-identity answers onto the Speakers row', () => {
    const draft = speakerDraftFor({
      participant: {
        role: 'speaker',
        isPrimary: true,
        identity: { email: 'ada@example.com', firstName: 'Ada', lastName: 'Okafor' },
        answers: { d: 'Northwind AI' },
      },
      fields: registryFields,
      eventId: 'ev1',
    })
    expect(draft.company).toBe('Northwind AI')
    expect(draft.firstName).toBe('Ada')
  })

  it('leaves a Speaker property alone when the form did not ask for it', () => {
    // `speakerFields` drops undefined, so an omitted key means "leave the column
    // alone". A returning speaker's existing bio must survive a form with no bio field.
    const draft = speakerDraftFor({
      participant: {
        role: 'speaker',
        isPrimary: true,
        identity: { email: 'ada@example.com', firstName: '', lastName: '' },
        answers: {},
      },
      fields: registryFields,
      eventId: 'ev1',
    })
    expect(draft.firstName).toBeUndefined()
    expect(draft.company).toBeUndefined()
    expect(draft.bio).toBeUndefined()
  })

  it('honours mapsToSpeakerField over the field type', () => {
    const draft = speakerDraftFor({
      participant: {
        role: 'speaker',
        isPrimary: true,
        identity: { email: 'ada@example.com', firstName: 'Ada', lastName: 'Okafor' },
        answers: { h: 'https://example.com/headshot.png' },
      },
      fields: [
        {
          id: 'h',
          type: 'text',
          label: 'Headshot link',
          required: false,
          mapsToSpeakerField: 'headshotUrl',
        },
      ],
      eventId: 'ev1',
    })
    expect(draft.headshotUrl).toBe('https://example.com/headshot.png')
  })
})

// The two things this file exists to pin: a required field behind an unmet
// condition is NOT an error (BUILD_SPEC section 5.1 strips hidden fields before
// validating), and a solo speaker submits successfully under the shipped defaults.
// The organizer hit a two-speaker minimum on his own form and called it out, so
// the second one is a requirement rather than a nicety.

import { describe, expect, it } from 'vitest'

import { DEFAULT_PARTICIPANT_ROLES } from '@/constants/status'
import {
  type Problem,
  ProblemCodes,
  validateAnswers,
  validateCrossFieldLimits,
  validateParticipants,
} from '@/features/forms/validate'
import type { CrossFieldLimit, FormField, ParticipantRoleRule } from '@/types/forms'

function codes(problems: readonly Problem[]): readonly string[] {
  return problems.map((problem) => problem.code)
}

const TITLE: FormField = {
  id: 'title',
  type: 'text',
  label: 'Title',
  required: true,
  maxLen: 10,
  locked: true,
}

describe('validateAnswers, required and hidden', () => {
  it('reports a visible required field left blank', () => {
    expect(codes(validateAnswers([TITLE], {}))).toEqual([ProblemCodes.REQUIRED])
    expect(codes(validateAnswers([TITLE], { title: '   ' }))).toEqual([ProblemCodes.REQUIRED])
  })

  it('does not report a required field that its condition hides', () => {
    const fields: readonly FormField[] = [
      { id: 'format', type: 'select', label: 'Format', required: false },
      {
        id: 'workshopLength',
        type: 'text',
        label: 'Workshop Length',
        required: true,
        showIf: { fieldId: 'format', op: 'eq', value: 'workshop' },
      },
    ]

    expect(validateAnswers(fields, { format: 'talk' })).toEqual([])
    expect(codes(validateAnswers(fields, { format: 'workshop' }))).toEqual([ProblemCodes.REQUIRED])
  })

  it('ignores an optional field left blank', () => {
    const optional: FormField = { id: 'notes', type: 'text', label: 'Notes', required: false }

    expect(validateAnswers([optional], {})).toEqual([])
  })

  it('treats a required unchecked checkbox as blank, because consent must be given', () => {
    const consent: FormField = { id: 'terms', type: 'checkbox', label: 'Terms', required: true }

    expect(codes(validateAnswers([consent], { terms: false }))).toEqual([ProblemCodes.REQUIRED])
    expect(validateAnswers([consent], { terms: true })).toEqual([])
  })
})

describe('validateAnswers, length caps', () => {
  it('accepts an answer exactly at the limit and rejects one character more', () => {
    expect(validateAnswers([TITLE], { title: 'a'.repeat(10) })).toEqual([])
    expect(codes(validateAnswers([TITLE], { title: 'a'.repeat(11) }))).toEqual([
      ProblemCodes.MAX_LEN,
    ])
  })

  it('falls back to the default cap for the type when the field declares none', () => {
    const uncapped: FormField = { id: 'bio', type: 'text', label: 'Bio', required: false }

    expect(validateAnswers([uncapped], { bio: 'a'.repeat(255) })).toEqual([])
    expect(codes(validateAnswers([uncapped], { bio: 'a'.repeat(256) }))).toEqual([
      ProblemCodes.MAX_LEN,
    ])
  })
})

describe('validateAnswers, options', () => {
  const track: FormField = {
    id: 'track',
    type: 'select',
    label: 'Track',
    required: true,
    options: [
      { value: 'ai', label: 'AI' },
      { value: 'sec', label: 'Security' },
    ],
  }

  it('rejects a value that is not one of the declared options', () => {
    expect(codes(validateAnswers([track], { track: 'quantum' }))).toEqual([
      ProblemCodes.OPTION_INVALID,
    ])
    expect(validateAnswers([track], { track: 'sec' })).toEqual([])
  })

  it('checks every value of a multiselect', () => {
    const tags: FormField = { ...track, id: 'tags', type: 'multiselect', label: 'Tags' }

    expect(codes(validateAnswers([tags], { tags: ['ai', 'quantum'] }))).toEqual([
      ProblemCodes.OPTION_INVALID,
    ])
    expect(validateAnswers([tags], { tags: ['ai', 'sec'] })).toEqual([])
  })

  it('checks nothing when the field declares no options', () => {
    const bare: FormField = { id: 'level', type: 'radio', label: 'Level', required: false }

    expect(validateAnswers([bare], { level: 'anything' })).toEqual([])
  })
})

describe('validateAnswers, formats', () => {
  function only(type: FormField['type'], value: unknown): readonly string[] {
    const field: FormField = { id: 'f', type, label: type, required: false }
    return codes(validateAnswers([field], { f: value }))
  }

  it('rejects a malformed email', () => {
    expect(only('email', 'speaker@example.com')).toEqual([])
    expect(only('email', 'speaker at example.com')).toEqual([ProblemCodes.EMAIL_INVALID])
    expect(only('email', 'speaker@example')).toEqual([ProblemCodes.EMAIL_INVALID])
  })

  it('rejects a url that is not an http link', () => {
    expect(only('url', 'https://example.com/talks')).toEqual([])
    expect(only('url', 'example.com')).toEqual([ProblemCodes.URL_INVALID])
  })

  it('accepts any http video host and rejects a non-link', () => {
    // Non-embeddable hosts are accepted as plain links (section 5.1b), so only a
    // value that is not a URL at all is a problem.
    expect(only('video', 'https://youtu.be/abc123')).toEqual([])
    expect(only('video', 'https://videos.example.org/talk.mp4')).toEqual([])
    expect(only('video', 'my talk video')).toEqual([ProblemCodes.VIDEO_URL_INVALID])
  })

  it('rejects a non-numeric number', () => {
    expect(only('number', '30')).toEqual([])
    expect(only('number', 30)).toEqual([])
    expect(only('number', '30 people')).toEqual([ProblemCodes.NUMBER_INVALID])
  })
})

describe('validateParticipants', () => {
  const roles: readonly ParticipantRoleRule[] = [
    { role: 'speaker', enabled: true, min: 1, max: 2 },
    { role: 'co_speaker', enabled: true, min: 0, max: 1 },
    { role: 'moderator', enabled: false, min: 0, max: 1 },
  ]

  it('accepts a single solo speaker under the shipped defaults', () => {
    // The default that matters most in the whole builder: a stranger offering one
    // talk, alone, must be able to submit it.
    const solo = [{ role: 'speaker' as const, isPrimary: true, id: 'p1' }]

    expect(validateParticipants(DEFAULT_PARTICIPANT_ROLES, solo)).toEqual([])
  })

  it('reports a role below its minimum', () => {
    const problems = validateParticipants(roles, [
      { role: 'co_speaker', isPrimary: true, id: 'p1' },
    ])

    expect(codes(problems)).toEqual([ProblemCodes.ROLE_MIN])
    expect(problems[0]?.role).toBe('speaker')
  })

  it('reports a role above its maximum', () => {
    const problems = validateParticipants(roles, [
      { role: 'speaker', isPrimary: true, id: 'p1' },
      { role: 'speaker', isPrimary: false, id: 'p2' },
      { role: 'speaker', isPrimary: false, id: 'p3' },
    ])

    expect(codes(problems)).toEqual([ProblemCodes.ROLE_MAX])
    expect(problems[0]?.role).toBe('speaker')
  })

  it('rejects a participant in a role the form did not enable', () => {
    const problems = validateParticipants(roles, [
      { role: 'speaker', isPrimary: true, id: 'p1' },
      { role: 'moderator', isPrimary: false, id: 'p2' },
    ])

    expect(codes(problems)).toEqual([ProblemCodes.ROLE_NOT_ENABLED])
    expect(problems[0]?.role).toBe('moderator')
  })

  it('rejects zero primaries and two primaries alike', () => {
    const none = validateParticipants(roles, [{ role: 'speaker', isPrimary: false, id: 'p1' }])
    const two = validateParticipants(roles, [
      { role: 'speaker', isPrimary: true, id: 'p1' },
      { role: 'co_speaker', isPrimary: true, id: 'p2' },
    ])

    expect(codes(none)).toEqual([ProblemCodes.PRIMARY_MISSING])
    expect(codes(two)).toEqual([ProblemCodes.PRIMARY_DUPLICATE])
  })

  it('says nothing about a primary when the cast is empty', () => {
    // The minimums already say the step is incomplete; a second problem would
    // point at a control that does not exist yet.
    expect(codes(validateParticipants(roles, []))).toEqual([ProblemCodes.ROLE_MIN])
  })
})

describe('validateCrossFieldLimits', () => {
  const combined: readonly CrossFieldLimit[] = [
    { fieldIds: ['title', 'description'], maxLen: 20, perParticipant: false },
  ]

  it('accepts a combined total exactly at the limit and rejects one over', () => {
    const atLimit = { title: 'a'.repeat(10), description: 'b'.repeat(10) }
    const overLimit = { title: 'a'.repeat(10), description: 'b'.repeat(11) }

    expect(validateCrossFieldLimits(combined, atLimit)).toEqual([])
    expect(codes(validateCrossFieldLimits(combined, overLimit))).toEqual([
      ProblemCodes.CROSS_FIELD_MAX_LEN,
    ])
  })

  it('ignores field ids the submission never answered', () => {
    expect(validateCrossFieldLimits(combined, { title: 'short' })).toEqual([])
  })

  it('measures a per-participant rule inside each participant separately', () => {
    const perParticipant: readonly CrossFieldLimit[] = [
      { fieldIds: ['bio', 'company'], maxLen: 10, perParticipant: true },
    ]
    const problems = validateCrossFieldLimits(perParticipant, {}, [
      { participantId: 'p1', answers: { bio: 'abcde', company: 'fghij' } },
      { participantId: 'p2', answers: { bio: 'abcdef', company: 'ghijkl' } },
    ])

    expect(codes(problems)).toEqual([ProblemCodes.CROSS_FIELD_MAX_LEN])
    expect(problems[0]?.participantId).toBe('p2')
    expect(problems[0]?.fieldIds).toEqual(['bio', 'company'])
  })

  it('applies a per-participant rule to the submission when no participants are given', () => {
    const perParticipant: readonly CrossFieldLimit[] = [
      { fieldIds: ['bio'], maxLen: 4, perParticipant: true },
    ]

    expect(codes(validateCrossFieldLimits(perParticipant, { bio: 'abcde' }))).toEqual([
      ProblemCodes.CROSS_FIELD_MAX_LEN,
    ])
  })
})

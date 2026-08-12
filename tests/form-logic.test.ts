// Conditional visibility is the rule that decides which answers exist at all, so
// every other form behaviour (required validation, routing, the review recap)
// inherits its mistakes. BUILD_SPEC section 5.1 runs it on both the client and the
// server, which means a disagreement here shows up as a submission that validated
// while filling and failed on submit.

import { describe, expect, it } from 'vitest'

import {
  answerLabels,
  answerLength,
  isAnswered,
  matchedTrackId,
  visibleFields,
} from '@/features/forms/logic'
import type { FieldCondition, FormField, RoutingConfig } from '@/types/forms'

function field(id: string, showIf?: FieldCondition): FormField {
  return { id, type: 'text', label: id, required: false, showIf }
}

function ids(fields: readonly FormField[]): readonly string[] {
  return fields.map((entry) => entry.id)
}

describe('visibleFields operators', () => {
  const format = field('format')

  it('shows an eq dependent only when the values match', () => {
    const detail = field('detail', { fieldId: 'format', op: 'eq', value: 'workshop' })
    const fields = [format, detail]

    expect(ids(visibleFields(fields, { format: 'workshop' }))).toEqual(['format', 'detail'])
    expect(ids(visibleFields(fields, { format: 'talk' }))).toEqual(['format'])
  })

  it('shows a neq dependent while the controller is still blank', () => {
    // "Show unless they picked X" is what the builder copy implies, and hiding it
    // until an unrelated field is touched is the wrong reading.
    const detail = field('detail', { fieldId: 'format', op: 'neq', value: 'workshop' })
    const fields = [format, detail]

    expect(ids(visibleFields(fields, {}))).toEqual(['format', 'detail'])
    expect(ids(visibleFields(fields, { format: 'talk' }))).toEqual(['format', 'detail'])
    expect(ids(visibleFields(fields, { format: 'workshop' }))).toEqual(['format'])
  })

  it('matches an in condition against any one of the listed values', () => {
    const detail = field('detail', { fieldId: 'format', op: 'in', value: ['workshop', 'panel'] })
    const fields = [format, detail]

    expect(ids(visibleFields(fields, { format: 'panel' }))).toEqual(['format', 'detail'])
    expect(ids(visibleFields(fields, { format: 'talk' }))).toEqual(['format'])
  })

  it('treats blank, whitespace and an empty multiselect as not answered', () => {
    const detail = field('detail', { fieldId: 'format', op: 'answered' })
    const fields = [format, detail]

    expect(ids(visibleFields(fields, {}))).toEqual(['format'])
    expect(ids(visibleFields(fields, { format: '   ' }))).toEqual(['format'])
    expect(ids(visibleFields(fields, { format: [] }))).toEqual(['format'])
    expect(ids(visibleFields(fields, { format: ['panel'] }))).toEqual(['format', 'detail'])
  })

  it('matches an eq condition against one option of a multiselect', () => {
    const detail = field('detail', { fieldId: 'format', op: 'eq', value: 'panel' })
    const fields = [format, detail]

    expect(ids(visibleFields(fields, { format: ['talk', 'panel'] }))).toEqual(['format', 'detail'])
  })

  it('compares a numeric answer against a string condition value', () => {
    const detail = field('detail', { fieldId: 'seats', op: 'eq', value: '30' })
    const fields = [field('seats'), detail]

    expect(ids(visibleFields(fields, { seats: 30 }))).toEqual(['seats', 'detail'])
  })
})

describe('visibleFields structure', () => {
  it('always shows a field with no condition', () => {
    const fields = [field('title'), field('description')]

    expect(ids(visibleFields(fields, {}))).toEqual(['title', 'description'])
  })

  it('hides a dependent whose controlling field is itself hidden', () => {
    // The case that makes a stripped-then-validated submission possible: the
    // controller matches on a stale answer nobody could have given.
    const fields = [
      field('format'),
      field('workshopLength', { fieldId: 'format', op: 'eq', value: 'workshop' }),
      field('roomSetup', { fieldId: 'workshopLength', op: 'answered' }),
    ]

    expect(ids(visibleFields(fields, { format: 'talk', workshopLength: '90' }))).toEqual(['format'])
    expect(ids(visibleFields(fields, { format: 'workshop', workshopLength: '90' }))).toEqual([
      'format',
      'workshopLength',
      'roomSetup',
    ])
  })

  it('preserves definition order regardless of where conditions sit', () => {
    const fields = [
      field('a', { fieldId: 'c', op: 'answered' }),
      field('b'),
      field('c'),
      field('d', { fieldId: 'b', op: 'answered' }),
    ]

    expect(ids(visibleFields(fields, { b: 'yes', c: 'yes' }))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('shows a field whose controller was deleted from the form', () => {
    // Hiding it would strip the answer silently and leave a required question
    // impossible to satisfy.
    const fields = [field('title'), field('orphan', { fieldId: 'deleted', op: 'answered' })]

    expect(ids(visibleFields(fields, {}))).toEqual(['title', 'orphan'])
  })

  it('does not hang on a circular pair of conditions', () => {
    const fields = [
      field('a', { fieldId: 'b', op: 'answered' }),
      field('b', { fieldId: 'a', op: 'answered' }),
    ]

    expect(ids(visibleFields(fields, { a: 'yes', b: 'yes' }))).toEqual(['a', 'b'])
  })
})

describe('isAnswered and answerLength', () => {
  it('treats an unchecked checkbox as unanswered but a checked one as answered', () => {
    expect(isAnswered(false)).toBe(false)
    expect(isAnswered(true)).toBe(true)
  })

  it('counts untyped answers as zero characters and arrays as their sum', () => {
    expect(answerLength(undefined)).toBe(0)
    expect(answerLength('abc')).toBe(3)
    expect(answerLength(['ab', 'cd'])).toBe(4)
  })
})

describe('matchedTrackId', () => {
  // Routing strips the answers itself, so it needs the field definitions as well
  // as the answers. See tests/form-sanitize.test.ts for why.
  const fields = [field('topic')]
  const routing: RoutingConfig = {
    rules: [
      { when: { fieldId: 'topic', op: 'eq', value: 'security' }, trackId: 'trk_sec' },
      { when: { fieldId: 'topic', op: 'in', value: ['ai', 'ml'] }, trackId: 'trk_ai' },
      { when: { fieldId: 'topic', op: 'answered' }, trackId: 'trk_any' },
    ],
    defaultTrackId: 'trk_default',
  }

  it('takes the first matching rule even when a later one also matches', () => {
    expect(matchedTrackId(routing, fields, { topic: 'security' })).toBe('trk_sec')
    expect(matchedTrackId(routing, fields, { topic: 'ml' })).toBe('trk_ai')
    expect(matchedTrackId(routing, fields, { topic: 'devops' })).toBe('trk_any')
  })

  it('does NOT apply the default track when no rule matches', () => {
    // The default belongs to the caller, and this is why. Returning it here made "a
    // rule chose this" indistinguishable from "nothing matched", so `prepare.ts` could
    // never let an answered Track question win and every submission filed under the
    // form's default. See the precedence test in tests/submissions-prepare.test.ts.
    expect(matchedTrackId(routing, fields, {})).toBeUndefined()
  })

  it('returns undefined when nothing matches and no default is configured', () => {
    expect(matchedTrackId({ rules: routing.rules }, fields, {})).toBeUndefined()
  })

  it('returns undefined for a form with no routing at all', () => {
    expect(matchedTrackId({ rules: [] }, fields, { topic: 'security' })).toBeUndefined()
  })
})

describe('answerLabels', () => {
  // The Review step recapped a speaker's own answers as `Format: workshop` and
  // `Tags: recAj3y7ITWrXBvUD`, because it printed `answerValues`, which is the STORED
  // form. That is right for evaluating a condition and wrong for showing a person, and
  // Track and Tags store Airtable record ids, so the recap was unreadable exactly where
  // it matters most: the last screen before submitting.
  const format: FormField = {
    id: 'format',
    type: 'select',
    label: 'Format',
    required: false,
    options: [
      { value: 'talk', label: 'Talk (30 min)' },
      { value: 'workshop', label: 'Workshop (90 min)' },
    ],
  }
  const tags: FormField = {
    id: 'tags',
    type: 'multiselect',
    label: 'Tags',
    required: false,
    options: [
      { value: 'recAj3y7ITWrXBvUD', label: 'Beginner Friendly' },
      { value: 'recKk1p2Qz8sTuVwX', label: 'Hands On' },
    ],
  }

  it('shows the label a speaker chose, not the value that gets stored', () => {
    expect(answerLabels(format, 'workshop')).toEqual(['Workshop (90 min)'])
  })

  it('resolves every value of a multi-select, which is where record ids leaked', () => {
    expect(answerLabels(tags, ['recAj3y7ITWrXBvUD', 'recKk1p2Qz8sTuVwX'])).toEqual([
      'Beginner Friendly',
      'Hands On',
    ])
  })

  it('passes a value with no matching option through unchanged', () => {
    // What makes this safe to call on every field rather than only on choice fields: a
    // text or number answer has no options and is already its own label. It also keeps a
    // stale answer visible instead of blanking it, so an option deleted since the answer
    // was given still recaps as something.
    expect(answerLabels(field('title'), 'My talk')).toEqual(['My talk'])
    expect(answerLabels(format, 'recDeletedSince')).toEqual(['recDeletedSince'])
  })

  it('answers nothing for an unanswered field', () => {
    expect(answerLabels(format, undefined)).toEqual([])
    expect(answerLabels(format, '')).toEqual([])
  })
})

describe('a checkbox controller that has not been touched', () => {
  // The regression: `CheckboxControl` writes an answer only on change, so an untouched box has
  // no entry in the answer record at all. A rule reading "show this when the box is unchecked"
  // therefore compared `eq "false"` against `undefined` and matched nothing, so the dependent
  // question stayed hidden until the speaker checked the box and unchecked it again, with the
  // box visibly unchecked the whole time. Found by Codex review.
  const consent = {
    id: 'consent',
    type: 'checkbox',
    label: 'Record my talk',
    required: false,
  } as FormField
  const detail = field('detail', { fieldId: 'consent', op: 'eq', value: 'false' })
  const fields = [consent, detail]

  it('reads an absent answer as unchecked', () => {
    expect(ids(visibleFields(fields, {}))).toEqual(['consent', 'detail'])
  })

  it('agrees with an explicit false', () => {
    expect(ids(visibleFields(fields, { consent: false }))).toEqual(['consent', 'detail'])
  })

  it('hides the dependent once the box is actually checked', () => {
    expect(ids(visibleFields(fields, { consent: true }))).toEqual(['consent'])
  })

  it('does not make an absent checkbox count as ANSWERED', () => {
    // Consent has to be given rather than merely submitted, so `answered` is deliberately
    // unaffected by the reading above.
    const gated = field('gated', { fieldId: 'consent', op: 'answered' })

    expect(ids(visibleFields([consent, gated], {}))).toEqual(['consent'])
    expect(ids(visibleFields([consent, gated], { consent: true }))).toEqual(['consent', 'gated'])
  })

  it('leaves every other field type alone: absent is still absent', () => {
    // Only a checkbox is total. A blank text field is genuinely unanswered, and a rule waiting
    // for a specific value must keep waiting rather than matching the empty string.
    const blank = field('blank')
    const dependent = field('dependent', { fieldId: 'blank', op: 'eq', value: 'false' })

    expect(ids(visibleFields([blank, dependent], {}))).toEqual(['blank'])
  })

  it('routes a track on the same reading', () => {
    // A track rule and a visibility rule on one question must not disagree about what the
    // unchecked state is.
    const routing: RoutingConfig = {
      rules: [{ when: { fieldId: 'consent', op: 'eq', value: 'false' }, trackId: 'recNoRecord' }],
      defaultTrackId: 'recDefault',
    }

    expect(matchedTrackId(routing, [consent], {})).toBe('recNoRecord')
    // Checked, so the rule does not fire and nothing is routed.
    expect(matchedTrackId(routing, [consent], { consent: true })).toBeUndefined()
  })
})

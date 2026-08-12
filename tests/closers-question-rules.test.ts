// Question rules are restricted by field type.
//
// The reference is explicit: conditional logic ("Question rules") is "Available for `Checkbox`,
// `Dropdown`, and `Number` fields", and "Create and save all fields before applying rules"
// (docs/parity/external-references.md, off `/sessions/submission-forms`). `select` is the stored
// name of the type the product labels `Dropdown`.
//
// The restriction is on AUTHORING, not on evaluation. `visibleFields` still resolves a rule
// stored against a Radio question, because a form built before the restriction must keep
// working, and `ruleControllers` keeps such a controller in the picker so the rule stays
// editable rather than turning into a value that silently matches nothing.

import { describe, expect, it } from 'vitest'

import {
  RULE_FIELD_TYPES,
  ruleControllers,
  ruleValueMode,
} from '@/features/forms/builder/field-ops'
import type { FormField } from '@/types/forms'

function field(over: Partial<FormField> & Pick<FormField, 'id' | 'type'>): FormField {
  return { label: over.id, required: false, ...over }
}

const CHECKBOX = field({ id: 'agree', type: 'checkbox' })
const DROPDOWN = field({
  id: 'format',
  type: 'select',
  options: [
    { value: 'talk', label: 'Talk' },
    { value: 'workshop', label: 'Workshop' },
  ],
})
const NUMBER = field({ id: 'attendees', type: 'number' })
const RADIO = field({ id: 'diet', type: 'radio', options: [{ value: 'none', label: 'None' }] })
const TEXT = field({ id: 'notes', type: 'text' })
const TARGET = field({ id: 'target', type: 'text' })

describe('RULE_FIELD_TYPES', () => {
  it('is exactly the three types the reference names', () => {
    expect([...RULE_FIELD_TYPES]).toEqual(['checkbox', 'select', 'number'])
  })
})

describe('ruleControllers', () => {
  it('offers Checkbox, Dropdown and Number questions asked before this one', () => {
    const fields = [CHECKBOX, DROPDOWN, NUMBER, TARGET]

    expect(ruleControllers(fields, 'target').map((entry) => entry.id)).toEqual([
      'agree',
      'format',
      'attendees',
    ])
  })

  it('does not offer a Radio or a Text question, which the reference excludes', () => {
    expect(ruleControllers([RADIO, TEXT, TARGET], 'target')).toEqual([])
  })

  it('still refuses a later question, so the one-dependency-level rule survives', () => {
    // A rule cannot depend on an answer the speaker has not been asked for yet, whatever the
    // controlling question's type is (BUILD_SPEC 5.1).
    expect(ruleControllers([TARGET, DROPDOWN], 'target')).toEqual([])
  })

  it('keeps the controller a stored rule already points at, so the rule stays editable', () => {
    const fields = [RADIO, DROPDOWN, TARGET]

    expect(ruleControllers(fields, 'target', 'diet').map((entry) => entry.id)).toEqual([
      'diet',
      'format',
    ])
  })

  it('does not resurrect a question that is excluded for POSITION by naming it', () => {
    expect(ruleControllers([TARGET, RADIO], 'target', 'diet')).toEqual([])
  })
})

describe('ruleValueMode', () => {
  it('matches an option for a Dropdown, which is what a typo-proof rule needs', () => {
    expect(ruleValueMode(DROPDOWN)).toBe('options')
  })

  it('names the two Checkbox states rather than asking anyone to type true', () => {
    expect(ruleValueMode(CHECKBOX)).toBe('boolean')
  })

  it('takes typed text for a Number, which has no option list to pick from', () => {
    // Without this, two of the three reference-eligible types were unusable: the value control
    // was an option picker, and a Number has no options, so only "is answered" could be saved.
    expect(ruleValueMode(NUMBER)).toBe('text')
  })

  it('has nothing to compare against for a choice question with no options yet', () => {
    expect(ruleValueMode(field({ id: 'empty', type: 'select', options: [] }))).toBe('none')
  })

  it('has nothing to compare against when no controller is selected', () => {
    expect(ruleValueMode(undefined)).toBe('none')
  })
})

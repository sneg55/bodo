// A choice question with nothing to choose from is not rendered on the public form.
//
// It became reachable on purpose. A form created on an event with no categories seeds Track
// and Tags with an empty option list, and refusing to SAVE that form was the CFP-01 defect
// (see `checkCategoryOptions`), so the form is now saveable and publishable. What must not
// follow is a stranger opening a call for papers and meeting two dropdowns that open onto
// nothing: this project deletes a dead control rather than showing it inert.
//
// The two exclusions are the whole reason this is a function rather than an `options.length`
// test at the call site, and both are about not hiding something that still matters: a
// REQUIRED question is what `visibleFields` runs validation over, and an ANSWERED one is the
// speaker's own answer.

import { describe, expect, it } from 'vitest'

import { isDeadChoice } from '@/features/forms/control-types'
import type { FormField } from '@/types/forms'

const track: FormField = {
  id: 'fld_track',
  type: 'select',
  label: 'Track',
  required: false,
  registryKey: 'track',
  options: [],
}

describe('a choice question with no options', () => {
  it('is not rendered when it is optional and unanswered', () => {
    expect(isDeadChoice(track, undefined)).toBe(true)
    expect(isDeadChoice({ ...track, options: undefined }, '')).toBe(true)
  })

  it('is not rendered for a Tags multiselect either, empty array included', () => {
    const tags: FormField = { ...track, id: 'fld_tags', type: 'multiselect', label: 'Tags' }

    expect(isDeadChoice(tags, [])).toBe(true)
  })

  it('is still rendered when it is required, because validation still demands it', () => {
    // The builder refuses to save required-with-no-options, so this is a form stored before
    // that check. Hiding it would be an unsubmittable wizard with nothing on screen to say why.
    expect(isDeadChoice({ ...track, required: true }, undefined)).toBe(false)
  })

  it('is still rendered when it already holds an answer', () => {
    // Options can be removed after a speaker has answered. Their answer is not ours to hide.
    expect(isDeadChoice(track, 'recInfra')).toBe(false)
    expect(isDeadChoice({ ...track, type: 'multiselect' }, ['recInfra'])).toBe(false)
  })
})

describe('every other question', () => {
  it('renders, options or not', () => {
    expect(isDeadChoice({ ...track, type: 'text', options: undefined }, undefined)).toBe(false)
    expect(isDeadChoice({ ...track, type: 'checkbox', options: undefined }, undefined)).toBe(false)
  })

  it('renders when the choice question does have options', () => {
    expect(
      isDeadChoice({ ...track, options: [{ value: 'recInfra', label: 'Infra' }] }, undefined),
    ).toBe(false)
  })
})

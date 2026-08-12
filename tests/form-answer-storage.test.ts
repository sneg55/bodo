// Where a submitted answer is stored is the structural decision in BUILD_SPEC
// section 3: a registry field with `column: true` lands in a first-class Airtable
// column that the Abstracts table can sort and filter on, everything else lands in
// `answersJson`. The only thing that may decide it is `FormField.registryKey`.
//
// Label, type and lock state must not decide it, because an organizer can add a
// local select called "Format" that has nothing to do with the registry's Format,
// and inferring from the label writes one submission's answer into another's
// column.

import { describe, expect, it } from 'vitest'

import { splitAnswers } from '@/features/forms/answer-storage'
import { FIXTURE_FORM } from '@/services/airtable/fixtures'
import type { FormField } from '@/types/forms'

const REGISTRY_FORMAT: FormField = {
  id: 'fld_format',
  type: 'select',
  label: 'Format',
  required: true,
  registryKey: 'format',
}

describe('splitAnswers, registry-keyed fields', () => {
  it('sends a registry-keyed answer to the Submission property it writes', () => {
    const split = splitAnswers([REGISTRY_FORMAT], { fld_format: 'workshop' })

    expect([...split.columns]).toEqual([['format', 'workshop']])
    expect(split.answers).toEqual({})
    expect(split.unmapped).toEqual([])
  })

  it('maps the two keys whose column name differs from the registry key', () => {
    // Both questions carry their options, because both write LINK columns and
    // `splitAnswers` resolves those answers against the question's own option list
    // instead of passing a string through to a link (`linkedOptionValues`). The mapping
    // under test is unchanged; the shape it arrives in is a resolved list.
    const fields: readonly FormField[] = [
      {
        id: 'a',
        type: 'select',
        label: 'Track',
        required: false,
        registryKey: 'track',
        options: [{ value: 'trk_ai', label: 'Agents' }],
      },
      {
        id: 'b',
        type: 'multiselect',
        label: 'Tags',
        required: false,
        registryKey: 'tags',
        options: [
          { value: 'tag_1', label: 'Shipping' },
          { value: 'tag_2', label: 'Evals' },
        ],
      },
    ]
    const split = splitAnswers(fields, { a: 'trk_ai', b: ['tag_1', 'tag_2'] })

    expect(split.columns.get('trackId')).toEqual(['trk_ai'])
    expect(split.columns.get('tagIds')).toEqual(['tag_1', 'tag_2'])
  })

  it('sends a registry field that the registry says is not a column to answers', () => {
    // `description` is a registry field with `column: false`, so answersJson is
    // where it belongs. That is a mapping, not a gap, and must not be reported.
    const description: FormField = {
      id: 'fld_desc',
      type: 'wysiwyg',
      label: 'Description',
      required: false,
      registryKey: 'description',
    }
    const split = splitAnswers([description], { fld_desc: '<p>Talk</p>' })

    expect(split.answers).toEqual({ fld_desc: '<p>Talk</p>' })
    expect(split.columns.size).toBe(0)
    expect(split.unmapped).toEqual([])
  })
})

describe('splitAnswers never infers', () => {
  it('sends a local field with the same label and type to answers', () => {
    const local: FormField = { ...REGISTRY_FORMAT, id: 'fld_local', registryKey: undefined }
    const split = splitAnswers([REGISTRY_FORMAT, local], {
      fld_format: 'workshop',
      fld_local: 'fireside',
    })

    expect(split.columns.get('format')).toBe('workshop')
    expect(split.answers).toEqual({ fld_local: 'fireside' })
  })

  it('ignores lock state, which is presentation rather than storage', () => {
    const locked: FormField = {
      id: 'fld_theme',
      type: 'select',
      label: 'Format',
      required: true,
      locked: true,
    }
    const split = splitAnswers([locked], { fld_theme: 'workshop' })

    expect(split.columns.size).toBe(0)
    expect(split.answers).toEqual({ fld_theme: 'workshop' })
  })
})

describe('splitAnswers, keys it cannot place', () => {
  it('reports an unknown registry key and keeps its answer', () => {
    // A key that no longer exists in the registry (renamed, removed) must not
    // take the answer down with it.
    const stale: FormField = {
      id: 'fld_stale',
      type: 'text',
      label: 'Sponsor Tier',
      required: false,
      registryKey: 'sponsorTier',
    }
    const split = splitAnswers([stale], { fld_stale: 'gold' })

    expect(split.unmapped).toEqual([{ fieldId: 'fld_stale', registryKey: 'sponsorTier' }])
    expect(split.answers).toEqual({ fld_stale: 'gold' })
  })

  it('reports a registry column that no mapping covers yet', () => {
    // `capacity` is a real column, so answersJson silently absorbing it would make
    // the Abstracts table unable to sort on a value it does own.
    const capacity: FormField = {
      id: 'fld_cap',
      type: 'number',
      label: 'Capacity',
      required: false,
      registryKey: 'capacity',
    }
    const split = splitAnswers([capacity], { fld_cap: 120 })

    expect(split.unmapped).toEqual([{ fieldId: 'fld_cap', registryKey: 'capacity' }])
    expect(split.answers).toEqual({ fld_cap: 120 })
  })
})

describe('splitAnswers, unanswered fields', () => {
  it('leaves out a field the submission never answered', () => {
    const split = splitAnswers([REGISTRY_FORMAT], {})

    expect(split.columns.size).toBe(0)
    expect(split.answers).toEqual({})
  })

  it('keeps a field answered with false or an empty string', () => {
    // Emptiness is validation's business. Dropping it here would turn "cleared" into
    // "never answered" and leave the old column value in place.
    const terms: FormField = { id: 'terms', type: 'checkbox', label: 'Terms', required: false }
    const split = splitAnswers([terms], { terms: false })

    expect(split.answers).toEqual({ terms: false })
  })

  it('ignores an answer whose key is not a field of the form', () => {
    const split = splitAnswers([REGISTRY_FORMAT], { fld_format: 'talk', injected: 'x' })

    expect(split.answers).toEqual({})
    expect(split.columns.get('format')).toBe('talk')
  })
})

describe('the fixture form is consistent with the rule', () => {
  it('splits the fixture into the columns and answers the fixtures already show', () => {
    const split = splitAnswers(FIXTURE_FORM.fields, {
      fld_title: 'Hands-on: building an eval harness',
      fld_desc: '<p>Ninety minutes, bring a laptop.</p>',
      fld_format: 'workshop',
      fld_lab: 'Python 3.12 and Docker installed',
    })

    // Title and Format are library fields with registry keys, so both land in
    // first-class columns and stay sortable in the Abstracts table.
    expect(Object.fromEntries(split.columns)).toEqual({
      title: 'Hands-on: building an eval harness',
      format: 'workshop',
    })
    // Description is keyed too, but the registry marks it `column: false`, so its
    // answer still belongs in answersJson. fld_lab has no key at all: it is a
    // question this organizer invented, and nothing infers a column from the fact
    // that it is a required text field.
    expect(split.answers).toEqual({
      fld_desc: '<p>Ninety minutes, bring a laptop.</p>',
      fld_lab: 'Python 3.12 and Docker installed',
    })
    expect(split.unmapped).toEqual([])
  })
})

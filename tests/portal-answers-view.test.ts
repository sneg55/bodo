// Reassembling a submission's answers out of the two halves storage split them into.

import { describe, expect, it } from 'vitest'

import { htmlToText, submittedAnswers } from '@/features/portal/answers-view'

import { field, form, submission } from './helpers/portal-fakes'

describe('submittedAnswers', () => {
  const cfp = form({
    fields: [
      field({ id: 'fld_title', label: 'Title', registryKey: 'title' }),
      field({ id: 'fld_desc', label: 'Description', type: 'wysiwyg', registryKey: 'description' }),
      field({ id: 'fld_format', label: 'Format', type: 'select', registryKey: 'format' }),
      field({ id: 'fld_lab', label: 'Lab setup requirements' }),
    ],
  })

  it('renders in the form field order, not in the order the answers were stored', () => {
    const rows = submittedAnswers({
      submission: submission({
        title: 'Evaluating agents',
        format: 'workshop',
        answers: { fld_lab: 'Docker', fld_desc: '<p>Bring a laptop.</p>' },
      }),
      form: cfp,
    })

    expect(rows.map((row) => row.label)).toEqual([
      'Title',
      'Description',
      'Format',
      'Lab setup requirements',
    ])
  })

  it('reads a registry-keyed answer out of its typed column', () => {
    const rows = submittedAnswers({
      submission: submission({ title: 'From the column', answers: {} }),
      form: cfp,
    })

    expect(rows.find((row) => row.label === 'Title')?.values).toEqual(['From the column'])
  })

  it('leaves an unanswered optional question off the page entirely', () => {
    const rows = submittedAnswers({
      submission: submission({ format: undefined, answers: {} }),
      form: cfp,
    })

    expect(rows.map((row) => row.label)).not.toContain('Format')
  })

  it('appends an answersJson key the form no longer asks about', () => {
    // A question that was deleted from the form. The speaker did answer it, so dropping it
    // silently would be unfalsifiable.
    const rows = submittedAnswers({
      submission: submission({ answers: { fld_retired: 'still here' } }),
      form: cfp,
    })

    expect(rows.at(-1)).toMatchObject({ key: 'fld_retired', values: ['still here'] })
  })

  it('resolves a track id to its name through the lookup', () => {
    const withTrack = form({
      fields: [field({ id: 'fld_track', label: 'Track', type: 'select', registryKey: 'track' })],
    })
    const rows = submittedAnswers({
      submission: submission({ trackId: 'recTrack1' }),
      form: withTrack,
      lookups: { nameOf: (id) => (id === 'recTrack1' ? 'Agents' : undefined) },
    })

    expect(rows[0]?.values).toEqual(['Agents'])
  })

  it('flattens a multi-valued answer into one value per entry', () => {
    const withTags = form({
      fields: [field({ id: 'fld_tags', label: 'Tags', type: 'multiselect', registryKey: 'tags' })],
    })
    const rows = submittedAnswers({
      submission: submission({ tagIds: ['recTag1', 'recTag2'] }),
      form: withTags,
      lookups: { nameOf: (id) => (id === 'recTag1' ? 'Live Demo' : 'Sponsor') },
    })

    expect(rows[0]?.values).toEqual(['Live Demo', 'Sponsor'])
  })

  it('falls back to typed columns and extras when there is no form', () => {
    // A manual submission. Field order comes from the form, and there is none, so only the
    // answersJson extras are addressable and they are labelled from the registry.
    const rows = submittedAnswers({
      submission: submission({ formId: undefined, answers: { description: '<p>Hello</p>' } }),
    })

    expect(rows).toEqual([{ key: 'description', label: 'Description', values: ['Hello'] }])
  })
})

describe('htmlToText', () => {
  it('turns block boundaries into newlines and keeps the paragraphs', () => {
    expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\nTwo')
  })

  it('strips tags rather than rendering them, so stored markup cannot execute', () => {
    // There is no HTML sanitizer in this codebase, which is exactly why the portal renders
    // stored rich text as text.
    expect(htmlToText('<p>hi<script>alert(1)</script></p>')).toBe('hialert(1)')
  })

  it('decodes entities last, so an escaped tag stays literal text', () => {
    expect(htmlToText('&lt;script&gt;')).toBe('<script>')
  })

  it('leaves plain text alone', () => {
    expect(htmlToText('just words')).toBe('just words')
  })
})

describe('choice labels in the frozen view, found by Codex review', () => {
  // The same defect as the CFP Review step, in a second place. This read-only view formatted a
  // stored value without consulting the field's own options, and the record-name lookup only
  // resolves Track and Tag IDS, so every other choice field showed its stored value: a speaker
  // saw `workshop` where they had chosen "Workshop (90 min)".
  const withOptions = form({
    fields: [
      field({
        id: 'fld_format',
        label: 'Format',
        type: 'select',
        registryKey: 'format',
        options: [
          { value: 'talk', label: 'Talk (30 min)' },
          { value: 'workshop', label: 'Workshop (90 min)' },
        ],
      }),
    ],
  })

  it('shows the label a speaker chose, not the value that was stored', () => {
    const rows = submittedAnswers({
      submission: submission({ format: 'workshop' }),
      form: withOptions,
    })

    expect(rows.find((row) => row.label === 'Format')?.values).toEqual(['Workshop (90 min)'])
  })

  it('falls back to the stored value when the field offers no matching option', () => {
    // An option deleted since the answer was given still shows something rather than vanishing.
    const rows = submittedAnswers({
      submission: submission({ format: 'retired-format' }),
      form: withOptions,
    })

    expect(rows.find((row) => row.label === 'Format')?.values).toEqual(['retired-format'])
  })
})

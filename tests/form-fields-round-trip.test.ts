// What survives a trip through Airtable, which is the only trip that matters.
//
// Every other test in this repo builds `FormField` objects in TypeScript, where every
// property is present by construction. That is exactly why a real bug lived here
// undetected: `formFieldSchema` did not declare `registryKey`, Zod strips unknown keys by
// default, and so a `fieldsJson` blob that carried `registryKey: "title"` arrived with it
// deleted. Nothing threw, nothing warned.
//
// The consequence ran the length of the CFP path. §3 makes that key "the ONLY thing
// allowed to decide where its answer is stored", so with it gone `splitAnswers` sent every
// answer to `answersJson`, no typed column was ever written, and `prepareSubmission` fell
// back to UNTITLED. A submission made through the real deployed form landed as "Untitled
// submission" with format, level, language, ceuCredits, trackId and tagIds all empty,
// which also empties the columns the Abstracts table sorts and filters on.
//
// So these tests parse blobs the way the DAL does, and the last one walks a parsed form
// into `prepareSubmission` to pin the outcome rather than the mechanism.

import { describe, expect, it } from 'vitest'

import { splitAnswers } from '@/features/forms/answer-storage'
import { prepareSubmission } from '@/features/submissions/prepare'
import { formFieldsSchema } from '@/services/airtable/schemas'
import type { Form, FormField } from '@/types/forms'

/** Exactly the shape the seeded form stores, registry keys included. */
const RAW_FIELDS = [
  { id: 'fld_title', type: 'text', label: 'Title', required: true, registryKey: 'title' },
  { id: 'fld_desc', type: 'wysiwyg', label: 'Description', registryKey: 'description' },
  {
    id: 'fld_format',
    type: 'select',
    label: 'Format',
    registryKey: 'format',
    options: [
      { value: 'talk', label: 'Talk (30 min)' },
      { value: 'workshop', label: 'Workshop (90 min)' },
    ],
  },
  { id: 'fld_lab', type: 'text', label: 'Lab setup requirements' },
]

function parsed(): readonly FormField[] {
  return formFieldsSchema.parse(RAW_FIELDS)
}

describe('parsing fieldsJson', () => {
  it('keeps registryKey, which Zod was silently stripping', () => {
    const fields = parsed()

    expect(fields.map((field) => field.registryKey)).toEqual([
      'title',
      'description',
      'format',
      undefined,
    ])
  })

  it('leaves a field with no registry key alone rather than inventing one', () => {
    // A locally added question belongs in `answersJson`, and guessing a key from its label
    // would write one question's answer into another question's column.
    expect(parsed().at(3)?.registryKey).toBeUndefined()
  })
})

describe('a parsed form routed through splitAnswers', () => {
  it('sends registry-keyed answers to their columns, not to answersJson', () => {
    const split = splitAnswers(parsed(), {
      fld_title: 'Reliable agents',
      fld_format: 'talk',
      fld_lab: 'Two power strips',
    })

    expect(split.columns.get('title')).toBe('Reliable agents')
    expect(split.columns.get('format')).toBe('talk')
    // The local question stays a blob answer, keyed by field id.
    expect(split.answers).toEqual({ fld_lab: 'Two power strips' })
  })

  it('keeps description in answersJson, which the registry declares on purpose', () => {
    const split = splitAnswers(parsed(), { fld_desc: '<p>hello</p>' })

    expect(split.columns.size).toBe(0)
    expect(split.answers).toEqual({ fld_desc: '<p>hello</p>' })
    // Deliberate, so it must not be reported as a mapping gap.
    expect(split.unmapped).toEqual([])
  })
})

describe('the outcome that was actually broken', () => {
  it('titles the submission from the answer instead of falling back to Untitled', () => {
    const form = {
      id: 'recForm1',
      eventId: 'recEvt1',
      publicId: 'cfp2026',
      kind: 'cfp',
      entityKind: 'abstracts',
      status: 'published',
      participantsEnabled: true,
      fields: parsed(),
      participantFields: [],
      routing: { rules: [] },
      roles: [{ role: 'speaker', enabled: true, min: 1, max: 1 }],
      crossFieldLimits: [],
      adminAlertOnNew: [],
      adminAlertOnUpdate: [],
    } as unknown as Form

    const result = prepareSubmission({
      form,
      eventId: 'recEvt1',
      now: new Date('2026-08-08T12:00:00.000Z'),
      existingCount: 0,
      payload: {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        answers: { fld_title: 'Reliable agents', fld_format: 'talk' },
        participants: [
          {
            key: 'p1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
            role: 'speaker',
            isPrimary: true,
            answers: {},
          },
        ],
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prepared.title).toBe('Reliable agents')
    expect(result.prepared.columns.format).toBe('talk')
    // A stripped key used to show up here as a silent fallback, never as a problem.
    expect(result.prepared.unmapped).toEqual([])
  })
})

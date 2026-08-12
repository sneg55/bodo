// The write direction of a form, and the round trip back through the mapper.
//
// Two things are pinned here. Clearing: `compact` drops `undefined`, so a welcome message
// or a close date an organizer just deleted has to leave as an explicit empty value or
// the old one stays published for the life of the record. And the blob round trip: the
// field array is stringified here and parsed by `formFieldsSchema` on the way back, which
// is the exact path on which `registryKey` was once silently stripped and every CFP
// submission landed as "Untitled submission" with no format, level, track or tags.

import { describe, expect, it } from 'vitest'
import { NEW_FORM_ID_COUNT, newFormDraft } from '@/features/forms/builder/defaults'
import { toFormWrite } from '@/features/forms/builder/draft'
import { mapForm } from '@/services/airtable/mapping-forms'
import { COL } from '@/services/airtable/tables'
import {
  formContentFields,
  formStatusFields,
  newFormFields,
} from '@/services/airtable/to-fields-forms'
import type { FormContent } from '@/types/forms'

const IDS = Array.from({ length: NEW_FORM_ID_COUNT }, (_, index) => `id${String(index)}`)

function content(overrides: Partial<FormContent> = {}): FormContent {
  const write = toFormWrite(
    newFormDraft({
      name: 'Session Submission Form',
      ids: IDS,
      trackOptions: [
        { value: 'recInfra', label: 'Infrastructure' },
        { value: 'recAgents', label: 'Agents' },
      ],
      tagOptions: [{ value: 'recAi', label: 'AI' }],
    }),
    'America/Los_Angeles',
  )
  return { ...write, ...overrides }
}

describe('formContentFields', () => {
  it('clears a deleted welcome message with an empty string, not by omitting the key', () => {
    const fields = formContentFields(content({ welcomeHtml: undefined }))

    expect(Object.hasOwn(fields, COL.welcomeHtml)).toBe(true)
    expect(fields[COL.welcomeHtml]).toBe('')
  })

  it('clears a removed close date and submission limit with null, which is what Airtable takes', () => {
    const fields = formContentFields(content({ closeDate: undefined, submissionLimit: undefined }))

    expect(fields[COL.closeDate]).toBeNull()
    expect(fields[COL.submissionLimit]).toBeNull()
  })

  it('writes admin recipients as the comma list the reader parses back', () => {
    const fields = formContentFields(content({ adminAlertOnNew: ['a@b.co', 'c@d.co'] }))

    expect(fields[COL.adminAlertOnNew]).toBe('a@b.co, c@d.co')
  })

  it('never writes the columns that are assigned once at creation', () => {
    const fields = formContentFields(content())

    expect(Object.hasOwn(fields, COL.publicId)).toBe(false)
    expect(Object.hasOwn(fields, COL.status)).toBe(false)
    expect(Object.hasOwn(fields, COL.event)).toBe(false)
  })
})

describe('newFormFields', () => {
  it('links the event as an array and stamps kind cfp', () => {
    const fields = newFormFields({
      eventId: 'recEvt',
      publicId: 'pub-1',
      kind: 'cfp',
      status: 'draft',
      write: content(),
    })

    expect(fields[COL.event]).toEqual(['recEvt'])
    expect(fields[COL.kind]).toBe('cfp')
    expect(fields[COL.status]).toBe('draft')
  })
})

describe('the round trip a saved form actually takes', () => {
  it('comes back out of mapForm with every registryKey intact', () => {
    const written = newFormFields({
      eventId: 'recEvt',
      publicId: 'pub-1',
      kind: 'cfp',
      status: 'published',
      write: content(),
    })
    const form = mapForm({ id: 'recForm', fields: written })

    expect(form.fields.map((field) => field.registryKey)).toEqual([
      'title',
      'description',
      'format',
      'tags',
      'track',
      'level',
    ])
  })

  it('brings a conditional rule and a routing rule back unchanged', () => {
    const base = content()
    const conditional = {
      ...base,
      fields: [
        ...base.fields,
        {
          id: 'fld_lab',
          type: 'text' as const,
          label: 'Lab setup requirements',
          required: true,
          maxLen: 255,
          showIf: { fieldId: 'id2', op: 'eq' as const, value: 'workshop' },
        },
      ],
      routing: {
        rules: [
          { when: { fieldId: 'id2', op: 'eq' as const, value: 'workshop' }, trackId: 'recInfra' },
        ],
        defaultTrackId: 'recAgents',
      },
    }
    const written = newFormFields({
      eventId: 'recEvt',
      publicId: 'pub-1',
      kind: 'cfp',
      status: 'published',
      write: conditional,
    })
    const form = mapForm({ id: 'recForm', fields: written })

    expect(form.fields.at(-1)?.showIf).toEqual({ fieldId: 'id2', op: 'eq', value: 'workshop' })
    expect(form.routing.rules).toEqual([
      { when: { fieldId: 'id2', op: 'eq', value: 'workshop' }, trackId: 'recInfra' },
    ])
    expect(form.routing.defaultTrackId).toBe('recAgents')
  })

  it('brings the roles panel back rather than falling through to the default', () => {
    const written = newFormFields({
      eventId: 'recEvt',
      publicId: 'pub-1',
      kind: 'cfp',
      status: 'draft',
      write: content({ roles: [{ role: 'speaker', enabled: true, min: 2, max: 3 }] }),
    })

    expect(mapForm({ id: 'recForm', fields: written }).roles).toEqual([
      { role: 'speaker', enabled: true, min: 2, max: 3 },
    ])
  })
})

describe('formStatusFields', () => {
  it('writes the status column and nothing else, so publishing cannot rewrite content', () => {
    expect(formStatusFields('published')).toEqual({ [COL.status]: 'published' })
  })
})

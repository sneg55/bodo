// What "Create Form" produces, pinned against BUILD_SPEC 5.1 and the parity transcript.
//
// A new form has to be submittable the moment it is published. The two ways that fails
// are a required dropdown with no options, which nobody can answer, and a Title question
// with no registry key, which lands every submission as "Untitled submission". Both are
// asserted here rather than discovered on a live form.

import { describe, expect, it } from 'vitest'
import { SESSION_FIELDS } from '@/constants/fields'
import { checkDraft, hasBlockingProblem } from '@/features/forms/builder/checks'
import {
  DEFAULT_ABSTRACT_KEYS,
  DEFAULT_PARTICIPANT_KEYS,
  fieldsForKeys,
  NEW_FORM_ID_COUNT,
  newFormDraft,
} from '@/features/forms/builder/defaults'
import { OPTION_TYPES, toFormWrite } from '@/features/forms/builder/draft'

/** The EVENT's zone: a close date is a wall-clock deadline in it, not in the runtime's. */
const ZONE = 'America/Los_Angeles'

const IDS = Array.from({ length: NEW_FORM_ID_COUNT }, (_, index) => `id${String(index)}`)
const TRACKS = [
  { value: 'recInfra', label: 'Infrastructure' },
  { value: 'recAgents', label: 'Agents' },
]

const TAGS = [{ value: 'recAi', label: 'AI' }]

function draft() {
  return newFormDraft({
    name: 'Submission Form',
    ids: IDS,
    trackOptions: TRACKS,
    tagOptions: TAGS,
  })
}

describe('newFormDraft', () => {
  it('seeds the six abstract questions the product shows, in order', () => {
    expect(draft().fields.map((field) => field.label)).toEqual([
      'Title',
      'Description',
      'Format',
      'Tags',
      'Track',
      'Level',
    ])
  })

  it('seeds the five participant questions the product shows, in order', () => {
    expect(draft().participantFields.map((field) => field.label)).toEqual([
      'First Name',
      'Last Name',
      'Email',
      'Mobile Phone',
      'Biography',
    ])
  })

  it('gives every seeded question a registry key, so no answer falls into answersJson', () => {
    const keys = draft().fields.map((field) => field.registryKey)

    expect(keys).toEqual(DEFAULT_ABSTRACT_KEYS)
  })

  it('locks Title and requires it, as the row transcript shows', () => {
    const title = draft().fields.at(0)

    expect(title?.locked).toBe(true)
    expect(title?.required).toBe(true)
    expect(title?.maxLen).toBe(255)
  })

  it('marks Level optional and the other classification questions required', () => {
    const required = new Map(draft().fields.map((field) => [field.label, field.required]))

    expect(required.get('Format')).toBe(true)
    expect(required.get('Track')).toBe(true)
    expect(required.get('Level')).toBe(false)
  })

  it('caps Description at 5,000 characters, which is the chip on the row', () => {
    expect(draft().fields.at(1)?.maxLen).toBe(5000)
  })

  it('fills the Track dropdown from the event own categories', () => {
    expect(draft().fields.at(4)?.options).toEqual(TRACKS)
  })

  it('seeds a choice question as optional when the event has no records to offer', () => {
    // A required dropdown with no options is a form nobody can submit, and an event with
    // no tracks yet would produce exactly that.
    const bare = newFormDraft({ name: 'F', ids: IDS })
    const byLabel = new Map(bare.fields.map((field) => [field.label, field]))

    expect(byLabel.get('Track')?.options).toEqual([])
    expect(byLabel.get('Track')?.required).toBe(false)
  })

  it('leaves no required choice question without options', () => {
    const unanswerable = draft().fields.filter(
      (field) =>
        field.required && OPTION_TYPES.includes(field.type) && (field.options ?? []).length === 0,
    )

    expect(unanswerable).toEqual([])
  })

  it('is savable as it stands, with no blocking problem', () => {
    const problems = checkDraft(draft(), ['recInfra', 'recAgents'])

    expect(hasBlockingProblem(problems)).toBe(false)
  })

  it('keeps every registry key through the write transform', () => {
    expect(toFormWrite(draft(), ZONE).fields.map((field) => field.registryKey)).toEqual(
      DEFAULT_ABSTRACT_KEYS,
    )
  })

  it('defaults to one required speaker and optional co-speakers', () => {
    const roles = draft().roles

    expect(roles.at(0)).toEqual({ role: 'speaker', enabled: true, min: 1, max: 1 })
    expect(roles.at(1)?.min).toBe(0)
  })

  it('starts as an abstracts form with participants collected', () => {
    expect(draft().entityKind).toBe('abstracts')
    expect(draft().participantsEnabled).toBe(true)
  })
})

describe('fieldsForKeys', () => {
  it('skips a key the registry does not know rather than inventing a field', () => {
    const fields = fieldsForKeys({
      keys: ['title', 'notARealKey'],
      registry: SESSION_FIELDS,
      ids: ['a', 'b'],
    })

    expect(fields.map((field) => field.registryKey)).toEqual(['title'])
  })

  it('needs one id per key and stops when it runs out', () => {
    const fields = fieldsForKeys({
      keys: DEFAULT_PARTICIPANT_KEYS,
      registry: SESSION_FIELDS,
      ids: [],
    })

    expect(fields).toEqual([])
  })
})

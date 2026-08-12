// A question whose options are not the form's to invent, and the save it used to make
// impossible.
//
// CFP-01: on the event the judge configured, Save was refused with `"Tags" offers categories
// that do not belong to this event. "Track" offers categories that do not belong to this
// event.` and there was no control anywhere in the builder that could produce a valid option,
// because the only options editor typed the label into the value and a Track value has to be
// a category RECORD ID. The form stayed a draft and could never be published.
//
// The same control aimed at Format, Level or Language wrote a value into an Airtable single
// select declared from a fixed vocabulary, which is the 422 that vocabularies.ts opens with.
//
// So the fix has two halves and both are pinned here: the editor offers exactly the values the
// column can hold (`optionSource`), and the checks stop refusing a save over a list the
// organizer was never given a way to fill.

import { describe, expect, it } from 'vitest'

import { SESSION_FORMATS } from '@/constants/vocabularies'
import { checkDraft, hasBlockingProblem } from '@/features/forms/builder/checks'
import type { FormDraft } from '@/features/forms/builder/draft'
import { DEFAULT_FORM_HEADINGS } from '@/features/forms/builder/headings'
import {
  isStorableOption,
  optionForChoice,
  optionSource,
  unstorableOptions,
} from '@/features/forms/builder/option-sources'
import type { FieldOption, FormField } from '@/types/forms'

const TRACKS: readonly FieldOption[] = [
  { value: 'recInfra', label: 'Infrastructure' },
  { value: 'recAgents', label: 'Agents' },
]
const TAGS: readonly FieldOption[] = [{ value: 'recBeginner', label: 'Beginner friendly' }]
const CATEGORIES = { trackOptions: TRACKS, tagOptions: TAGS }

const TITLE: FormField = {
  id: 'fld_title',
  type: 'text',
  label: 'Title',
  required: true,
  locked: true,
  registryKey: 'title',
}

function question(overrides: Partial<FormField>): FormField {
  return { id: 'fld_track', type: 'select', label: 'Track', required: false, ...overrides }
}

function draft(fields: readonly FormField[]): FormDraft {
  return {
    ...DEFAULT_FORM_HEADINGS,
    name: 'DevFlow Conf 2027 CFP',
    entityKind: 'abstracts',
    participantsEnabled: false,
    welcomeEnabled: false,
    welcomeHtml: '',
    successHtml: '',
    fields,
    participantFields: [],
    routing: { rules: [], defaultTrackId: undefined },
    roles: [{ role: 'speaker', enabled: true, min: 1, max: 1 }],
    crossFieldLimits: [],
    closeDate: '',
    submissionLimitEnabled: false,
    submissionLimit: '',
    allowMultipleDrafts: false,
    autoRedirectToPortal: true,
    confirmationEmailEnabled: false,
    confirmationEmailHtml: '',
    adminAlertOnNew: [],
    adminAlertOnUpdate: [],
  }
}

const messages = (problems: readonly { message: string }[]): string =>
  problems.map((problem) => problem.message).join(' | ')

const trackIds = TRACKS.map((track) => track.value)
const tagIds = TAGS.map((tag) => tag.value)

describe('what the question editor may offer', () => {
  it('offers this event’s own categories for Track and for Tags', () => {
    const track = optionSource(question({ registryKey: 'track' }), CATEGORIES)
    const tags = optionSource(
      question({ id: 'fld_tags', type: 'multiselect', label: 'Tags', registryKey: 'tags' }),
      CATEGORIES,
    )

    expect(track?.choices).toEqual(TRACKS)
    expect(track?.settingsTab).toBe('tracks')
    expect(tags?.choices).toEqual(TAGS)
    expect(tags?.settingsTab).toBe('tags')
  })

  it('offers the declared vocabulary for Format, so no option can 422 the submission', () => {
    const format = optionSource(question({ label: 'Format', registryKey: 'format' }), CATEGORIES)

    expect(format?.origin).toBe('vocabulary')
    expect(format?.choices.map((choice) => choice.value)).toEqual(
      SESSION_FORMATS.map((choice) => choice.value),
    )
  })

  it('leaves a question the organizer invented on the free-text editor', () => {
    expect(optionSource(question({ registryKey: undefined }), CATEGORIES)).toBeUndefined()
  })

  it('ticks an option that carries the human label, rather than adding a second copy', () => {
    // A form built by hand stores `Talk` where the seeded one stores `talk`. Both are the
    // same choice, and `canonicalChoice` stores either, so the picker has to see them as one.
    const format = optionSource(question({ label: 'Format', registryKey: 'format' }), CATEGORIES)
    const options: readonly FieldOption[] = [{ value: 'Talk', label: 'Talk (30 min)' }]
    const talk = SESSION_FORMATS.find((choice) => choice.value === 'talk')

    expect(format).toBeDefined()
    expect(talk).toBeDefined()
    if (format === undefined || talk === undefined) return
    expect(optionForChoice(format, options, talk)?.label).toBe('Talk (30 min)')
    expect(isStorableOption(format, 'Talk')).toBe(true)
    expect(isStorableOption(format, 'Talk (30 min)')).toBe(false)
  })

  it('names the options that cannot be stored, which is what the editor lists for removal', () => {
    const format = optionSource(question({ label: 'Format', registryKey: 'format' }), CATEGORIES)
    const field = question({
      label: 'Format',
      registryKey: 'format',
      options: [
        { value: 'talk', label: 'Talk' },
        { value: 'Fireside chat', label: 'Fireside chat' },
      ],
    })

    expect(format).toBeDefined()
    if (format === undefined) return
    expect(unstorableOptions(field, format).map((option) => option.value)).toEqual([
      'Fireside chat',
    ])
  })
})

describe('the save an organizer could not get past', () => {
  it('no longer blocks a new form on an event that has no categories yet', () => {
    // What "Create Form" seeds on a fresh event: Track and Tags with nothing to offer, because
    // the event has no categories. The generic "choice question with no options" rule made
    // that form unsaveable from the moment it was created, over a list the builder could not
    // author. It is now a warning that says where categories come from.
    const problems = checkDraft(
      draft([
        TITLE,
        question({ registryKey: 'track', options: [] }),
        question({
          id: 'fld_tags',
          type: 'multiselect',
          label: 'Tags',
          registryKey: 'tags',
          options: [],
        }),
      ]),
      [],
      [],
    )

    expect(hasBlockingProblem(problems)).toBe(false)
    expect(messages(problems)).toContain('Event Settings > Tags')
  })

  it('still blocks when the organizer made that question required', () => {
    const problems = checkDraft(
      draft([TITLE, question({ registryKey: 'track', required: true, options: [] })]),
      [],
      [],
    )

    expect(hasBlockingProblem(problems)).toBe(true)
  })

  it('still refuses another event’s category, and now says where to fix it', () => {
    const problems = checkDraft(
      draft([
        TITLE,
        question({ registryKey: 'track', options: [{ value: 'Frontend', label: 'Frontend' }] }),
      ]),
      trackIds,
      tagIds,
    )

    expect(hasBlockingProblem(problems)).toBe(true)
    // NAMES the offending option, like the Format message next to it does. It used to say
    // only that the question offered "categories that do not belong to this event", which
    // tells an organizer looking at a list of plausible track names nothing about which one.
    expect(messages(problems)).toContain('"Frontend"')
    expect(messages(problems)).toContain('on this event, so an answer of')
    expect(messages(problems)).toContain("pick from this event's categories")
  })

  it('accepts the picker’s own output', () => {
    const problems = checkDraft(
      draft([TITLE, question({ registryKey: 'track', options: [TRACKS[0] ?? TAGS[0]] })]),
      trackIds,
      tagIds,
    )

    expect(problems).toEqual([])
  })

  it('warns, without blocking the SAVE, about a Format option the column cannot store', () => {
    // Not an error: `canonicalChoice` drops the unmatched answer rather than 422-ing the whole
    // submission now, and a form that already carries such an option has to stay saveable
    // while the organizer fixes it. That was the mistake the category check used to make.
    const problems = checkDraft(
      draft([
        TITLE,
        question({
          id: 'fld_format',
          label: 'Format',
          registryKey: 'format',
          options: [{ value: 'Fireside chat', label: 'Fireside chat' }],
        }),
      ]),
      trackIds,
      tagIds,
    )

    expect(hasBlockingProblem(problems)).toBe(false)
    expect(messages(problems)).toContain('"Fireside chat"')
  })

  it('says nothing about a Format question drawn from the vocabulary', () => {
    const problems = checkDraft(
      draft([
        TITLE,
        question({
          id: 'fld_format',
          label: 'Format',
          registryKey: 'format',
          options: [{ value: 'talk', label: 'Talk (30 min)' }],
        }),
      ]),
      trackIds,
      tagIds,
    )

    expect(problems).toEqual([])
  })
})

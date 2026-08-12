// The gate the SAVE deliberately does not apply, and the twin of the CFP-15 finding.
//
// The builder had two verdicts and needed three. An `error` refuses the save, which is what
// made a form on an event with no categories unsaveable from birth (CFP-01), so the option
// checks were softened to warnings. A warning refuses nothing, so a form offering options
// the column behind them cannot store went PUBLIC on a message the organizer could click
// straight past, and from then on every answer to one of those options was dropped silently.
// The CFP-01 run found three offered Formats in exactly that state on a live form.
//
// Publish is the right gate: it is the last moment the half-built form is still the
// organizer's own business rather than a stranger's lost answer. So `blocksPublish`
// (problem.ts) marks the warnings that mean "an answer to this would be lost", the save
// keeps ignoring them, and `publishBlockers` refuses them.

import { describe, expect, it } from 'vitest'

import { checkDraft, hasBlockingProblem, publishBlockers } from '@/features/forms/builder/checks'
import type { FormDraft } from '@/features/forms/builder/draft'
import { DEFAULT_FORM_HEADINGS } from '@/features/forms/builder/headings'
import type { FieldOption, FormField } from '@/types/forms'

const TRACKS: readonly FieldOption[] = [
  { value: 'recInfra', label: 'Platform & Infra' },
  { value: 'recAgents', label: 'Agents' },
]
const TAGS: readonly FieldOption[] = [{ value: 'recBeginner', label: 'Beginner friendly' }]
const trackIds = TRACKS.map((track) => track.value)
const tagIds = TAGS.map((tag) => tag.value)

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

describe('what refuses a publish but not a save', () => {
  it('refuses to publish a form offering a Format the column cannot store', () => {
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
    expect(publishBlockers(problems)).toHaveLength(1)
    expect(messages(problems)).toContain('would be dropped')
  })

  it('refuses to publish a Track question that offers none of this event’s categories', () => {
    // The CFP-15 shape, and the reason Track needed the same treatment as Format. A "Track"
    // added from the field library starts with NO options (`fieldFromRegistry`), so the
    // speaker is shown a control with an empty list, the `track` column stays empty however
    // they answer, and the routing rule files every talk under a track nobody chose.
    const problems = checkDraft(
      draft([TITLE, question({ registryKey: 'track', options: [] })]),
      trackIds,
      tagIds,
    )

    expect(hasBlockingProblem(problems)).toBe(false)
    expect(publishBlockers(problems)).toHaveLength(1)
    expect(messages(problems)).toContain('nobody can answer it')
  })

  it('still lets a form publish when the event has no categories at all', () => {
    // Deliberately NOT blocked. There is nothing for the organizer to pick and the remedy is
    // on another screen entirely, so refusing here would hold a whole call for papers hostage
    // to a Library they may never intend to fill. That is the CFP-01 mistake one gate along.
    const problems = checkDraft(
      draft([TITLE, question({ registryKey: 'track', options: [] })]),
      [],
      [],
    )

    expect(hasBlockingProblem(problems)).toBe(false)
    expect(publishBlockers(problems)).toEqual([])
  })

  it('still refuses to publish everything the save already refused', () => {
    const problems = checkDraft(
      draft([
        TITLE,
        question({ registryKey: 'track', options: [{ value: 'Frontend', label: 'Frontend' }] }),
      ]),
      trackIds,
      tagIds,
    )

    expect(hasBlockingProblem(problems)).toBe(true)
    expect(publishBlockers(problems)).toHaveLength(1)
  })

  it('publishes a form every one of whose options its column can store', () => {
    const problems = checkDraft(
      draft([TITLE, question({ registryKey: 'track', options: [...TRACKS] })]),
      trackIds,
      tagIds,
    )

    expect(publishBlockers(problems)).toEqual([])
  })
})

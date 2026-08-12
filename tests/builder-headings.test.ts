// The participant-facing copy: how the editor's eight strings become stored values, what
// the checks say about them, and which rail label the public wizard ends up with.
//
// Three things are pinned here and each one was a real failure mode of the surface these
// columns replaced:
//
//   - A cleared rich text editor must store NOTHING. TipTap leaves `<p></p>` behind, which
//     is not whitespace, so a "Description & Instructions" the organizer emptied would
//     otherwise store markup and the public step would render an empty paragraph instead of
//     falling back. The welcome body already had this bug once.
//   - An empty heading must not BLOCK a save. Every form created before these columns
//     existed has all eight empty, so an error would refuse to save a form the organizer
//     had only opened, while an over-cap value is a value the wizard cannot render.
//   - An unwritten Page Heading must leave the transcribed rail label in place. Those five
//     labels are read off ref 16 and familiarity is scored.

import { describe, expect, it } from 'vitest'

import { checkDraft, hasBlockingProblem } from '@/features/forms/builder/checks'
import { newFormDraft } from '@/features/forms/builder/defaults'
import { draftFromForm, type FormDraft, toFormWrite } from '@/features/forms/builder/draft'
import {
  DEFAULT_FORM_HEADINGS,
  EMPTY_FORM_HEADINGS,
  headingsFromForm,
  PAGE_HEADING_MAX,
  SECTION_TITLE_MAX,
} from '@/features/forms/builder/headings'
import { railLabels } from '@/features/submissions/rail-labels'
import { FIXTURE_FORM } from '@/services/airtable/fixtures/form'
import type { Form } from '@/types/forms'

const ZONE = 'America/Los_Angeles'

const TRACKS = ['recTrack1']
const TAGS = ['recTag1']

/**
 * A seeded form, which is what "Create Form" produces. Track and Tags are given real option
 * lists because a seeded dropdown with none is a separate error this file is not about.
 */
function draft(overrides: Partial<FormDraft> = {}): FormDraft {
  return {
    ...newFormDraft({
      name: 'Session Submission Form',
      ids: idsFor(),
      trackOptions: [{ value: 'recTrack1', label: 'Infrastructure' }],
      tagOptions: [{ value: 'recTag1', label: 'Agents' }],
    }),
    ...overrides,
  }
}

/** One id per seeded question, which is what `newFormDraft` asks of its caller. */
function idsFor(): readonly string[] {
  return Array.from({ length: 11 }, (_, index) => `f${String(index)}`)
}

function messages(problems: readonly { message: string }[]): string {
  return problems.map((problem) => problem.message).join(' | ')
}

describe('headings mapping', () => {
  it('reads a form with no authored copy as eight empty strings, never undefined', () => {
    // A control binds to a string. This is the case every existing form is in.
    expect(headingsFromForm(FIXTURE_FORM)).toEqual(EMPTY_FORM_HEADINGS)
  })

  it('round-trips authored copy through the draft and back to the stored shape', () => {
    const form: Form = { ...FIXTURE_FORM, ...DEFAULT_FORM_HEADINGS }
    const write = toFormWrite(draftFromForm(form, ZONE), ZONE)

    expect(write.externalTitle).toBe('Welcome to our event!')
    expect(write.welcomeHeading).toBe('Welcome!')
    expect(write.abstractSectionTitle).toBe('Tell us about your submission')
    expect(write.abstractHeading).toBe('Submission')
    expect(write.participantSectionTitle).toBe('Tell us about you')
    expect(write.participantHeading).toBe('Participant')
    expect(write.abstractSectionHtml).toBe(DEFAULT_FORM_HEADINGS.abstractSectionHtml)
    expect(write.participantSectionHtml).toBe(DEFAULT_FORM_HEADINGS.participantSectionHtml)
  })

  it('stores nothing for a title that is only whitespace, and trims the rest', () => {
    const write = toFormWrite(draft({ externalTitle: '   ', welcomeHeading: '  Welcome!  ' }), ZONE)

    expect(write.externalTitle).toBeUndefined()
    expect(write.welcomeHeading).toBe('Welcome!')
  })

  it('stores nothing for a description emptied to TipTap’s own empty paragraph', () => {
    const write = toFormWrite(
      draft({ abstractSectionHtml: '<p></p>', participantSectionHtml: '<p>&nbsp;</p>' }),
      ZONE,
    )

    expect(write.abstractSectionHtml).toBeUndefined()
    expect(write.participantSectionHtml).toBeUndefined()
  })

  it('keeps the markup of a description that has content, rather than trimming it', () => {
    const html = '<p><strong>Tell us</strong> about it.</p>'

    expect(toFormWrite(draft({ abstractSectionHtml: html }), ZONE).abstractSectionHtml).toBe(html)
  })

  it('seeds a new form with the transcribed copy, so nothing publishes with blank headings', () => {
    expect(newFormDraft({ name: 'Submission Form', ids: idsFor() }).externalTitle).toBe(
      'Welcome to our event!',
    )
  })
})

describe('checkDraft, authored copy', () => {
  it('accepts the seeded copy with no problem at all', () => {
    expect(checkDraft(draft(), TRACKS, TAGS)).toEqual([])
  })

  it('warns rather than blocks when a heading is empty, so an old form still saves', () => {
    const problems = checkDraft(draft({ ...EMPTY_FORM_HEADINGS }), TRACKS, TAGS)

    expect(hasBlockingProblem(problems)).toBe(false)
    // One warning per step, not one per input: three screens, three messages.
    expect(problems).toHaveLength(3)
    expect(messages(problems)).toContain(
      'External Form Title and Page Heading are empty, so the public form falls back to its own wording.',
    )
    expect(problems.map((problem) => problem.step)).toEqual([2, 3, 4])
  })

  it('does not ask for the participant copy when the form collects no participants', () => {
    const problems = checkDraft(
      draft({ ...EMPTY_FORM_HEADINGS, participantsEnabled: false }),
      TRACKS,
      TAGS,
    )

    expect(problems.every((problem) => problem.step !== 4)).toBe(true)
  })

  it('blocks a page heading over its 15 character cap, which the rail cannot render', () => {
    const problems = checkDraft(
      draft({ welcomeHeading: 'W'.repeat(PAGE_HEADING_MAX + 1) }),
      TRACKS,
      TAGS,
    )

    expect(hasBlockingProblem(problems)).toBe(true)
    expect(messages(problems)).toContain('Page Heading is over its 15 character limit.')
  })

  it('blocks a section title over its 255 character cap', () => {
    const problems = checkDraft(
      draft({ abstractSectionTitle: 'T'.repeat(SECTION_TITLE_MAX + 1) }),
      TRACKS,
      TAGS,
    )

    expect(hasBlockingProblem(problems)).toBe(true)
    expect(problems.at(0)?.step).toBe(3)
  })

  it('says nothing at all about a portal form, which has no heading controls', () => {
    // `entityType` is what distinguishes the two: set on a portal form, absent on a CFP.
    const problems = checkDraft(
      draft({ ...EMPTY_FORM_HEADINGS, entityType: 'contact', participantsEnabled: false }),
      TRACKS,
      TAGS,
    )

    expect(problems).toEqual([])
  })
})

describe('railLabels', () => {
  it('keeps the transcribed labels when the organizer wrote no page headings', () => {
    const labels = railLabels({})

    expect(labels.get('welcome')).toBe('Welcome!')
    expect(labels.get('submission')).toBe('Submission')
    expect(labels.get('participant')).toBe('Participant')
    // Never overridable: there is no builder control behind either of these two.
    expect(labels.get('account')).toBe('Account')
    expect(labels.get('review')).toBe('Review')
  })

  it('applies the organizer’s headings, trimmed, over the defaults', () => {
    const labels = railLabels({
      welcomeHeading: '  Hello!  ',
      abstractHeading: 'Your talk',
      participantHeading: 'Speakers',
    })

    expect(labels.get('welcome')).toBe('Hello!')
    expect(labels.get('submission')).toBe('Your talk')
    expect(labels.get('participant')).toBe('Speakers')
  })

  it('ignores a heading that is only whitespace rather than blanking a rail label', () => {
    expect(railLabels({ welcomeHeading: '   ' }).get('welcome')).toBe('Welcome!')
  })
})

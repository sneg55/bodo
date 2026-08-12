// The form editor loses no question between adding it and saving it.
//
// CFP-01 in the evaluation run reported that "an intervening save silently dropped the newly
// added fields", and F12 of the remediation plan reported the same shape twice: a question
// added from the Add Field menu is on screen, Save reports success, and it is gone after a
// reload. Both are the same mechanic and neither of them errors, which is why they need a
// test rather than a fix and a shrug.
//
// The mechanic is that every edit used to be computed from the copy of the draft its
// component had been RENDERED with, and the save path then merged a whole-draft snapshot back
// into state. Two edits derived from one copy do not merge, they overwrite. React only keeps
// that safe when a re-render lands between them, which is timing, not code: an organizer or a
// browser agent that adds a question and saves inside one task gets both handlers run against
// the same render.
//
// So these tests apply edits the way the editor now does, through the updater form, and pin
// that an edit derived from a STALE copy cannot take a newer one down with it.

import { describe, expect, it } from 'vitest'
import type { FormDraft } from '@/features/forms/builder/draft'
import {
  addQuestion,
  applyPatch,
  moveQuestion,
  patchQuestion,
  questionsOf,
  removeQuestion,
} from '@/features/forms/builder/draft-edits'
import { fillEmptyHeadings, headingsOf } from '@/features/forms/builder/heading-defaults'
import { DEFAULT_FORM_HEADINGS } from '@/features/forms/builder/headings'
import type { FormField } from '@/types/forms'

const TITLE: FormField = {
  id: 'fld_title',
  type: 'text',
  label: 'Title',
  required: true,
  locked: true,
  registryKey: 'title',
}
const TAKEAWAY: FormField = { id: 'fld_take', type: 'text', label: 'Key takeaway', required: true }
const AUDIENCE: FormField = {
  id: 'fld_audience',
  type: 'select',
  label: 'Audience level',
  required: true,
  options: [
    { value: 'beginner', label: 'Beginner' },
    { value: 'intermediate', label: 'Intermediate' },
    { value: 'advanced', label: 'Advanced' },
  ],
}

function draft(overrides: Partial<FormDraft> = {}): FormDraft {
  return {
    ...DEFAULT_FORM_HEADINGS,
    name: 'DevFlow Conf 2027 CFP',
    entityKind: 'abstracts',
    participantsEnabled: true,
    welcomeEnabled: false,
    welcomeHtml: '',
    successHtml: '',
    fields: [TITLE],
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
    ...overrides,
  }
}

const ids = (fields: readonly FormField[]): readonly string[] => fields.map((field) => field.id)

describe('adding two questions before anything re-renders', () => {
  it('keeps both, because each edit is computed from the draft it is applied to', () => {
    // The two questions CFP-01 asked for, added back to back the way the menu adds them.
    const first = applyPatch(draft(), (current) => addQuestion(current, 'abstract', TAKEAWAY))
    const both = applyPatch(first, (current) => addQuestion(current, 'abstract', AUDIENCE))

    expect(ids(both.fields)).toEqual(['fld_title', 'fld_take', 'fld_audience'])
  })

  it('shows what the value form used to do, which is the bug', () => {
    // This is the old call shape: the second edit built from `fields` as the component was
    // rendered with them, before the first edit landed. Nothing errors and the patch is
    // well-formed. It just has one fewer question in it than the screen does.
    const stale = draft()
    const first = applyPatch(stale, (current) => addQuestion(current, 'abstract', TAKEAWAY))
    const overwritten = applyPatch(first, addQuestion(stale, 'abstract', AUDIENCE))

    expect(ids(overwritten.fields)).toEqual(['fld_title', 'fld_audience'])
  })

  it('keeps an edit made to one list while the other is being edited', () => {
    const withQuestion = applyPatch(draft(), (current) =>
      addQuestion(current, 'abstract', TAKEAWAY),
    )
    const withBoth = applyPatch(withQuestion, (current) =>
      addQuestion(current, 'participant', { ...AUDIENCE, id: 'fld_role' }),
    )

    expect(ids(withBoth.fields)).toContain('fld_take')
    expect(ids(withBoth.participantFields)).toEqual(['fld_role'])
  })
})

describe('filling the required headings on save', () => {
  it('carries the eight strings and nothing else, so it cannot restore an old field list', () => {
    // The save path fills the eight participant-facing strings and merges the result back
    // into the editor's state. `fillEmptyHeadings` returns whatever it was handed, and it
    // used to be handed the whole draft, so that merge put the click-time FIELD LIST back
    // too. A question added between the render and the click was simply gone.
    const stale = draft({ externalTitle: '', abstractHeading: '' })
    const live = applyPatch(stale, (current) => addQuestion(current, 'abstract', TAKEAWAY))

    const { headings, filled } = fillEmptyHeadings(headingsOf(stale), true)
    const saved = applyPatch(live, headings)

    expect(filled.length).toBeGreaterThan(0)
    expect(saved.externalTitle).toBe(DEFAULT_FORM_HEADINGS.externalTitle)
    expect(ids(saved.fields)).toEqual(['fld_title', 'fld_take'])
  })

  it('narrows a whole draft down to the eight authored strings', () => {
    expect(Object.keys(headingsOf(draft())).sort()).toEqual(
      Object.keys(DEFAULT_FORM_HEADINGS).sort(),
    )
  })
})

describe('a portal form, which shares these edits and has one question list', () => {
  // The portal editor had the same defect and now calls the same functions with the
  // `abstract` kind, which is the only list a portal form has. Its answers go to
  // `TaskAssignments.answersJson`, it authors no routing, and this pins that the routing prune
  // `removeQuestion` carries is genuinely a no-op there rather than a write nobody meant.
  const portal = (): FormDraft =>
    draft({ entityType: 'submission', participantsEnabled: false, fields: [] })

  it('keeps both questions added back to back', () => {
    const one = applyPatch(portal(), (current) => addQuestion(current, 'abstract', TAKEAWAY))
    const two = applyPatch(one, (current) => addQuestion(current, 'abstract', AUDIENCE))

    expect(ids(two.fields)).toEqual(['fld_take', 'fld_audience'])
  })

  it('leaves the empty routing exactly as it found it when a question is removed', () => {
    const one = applyPatch(portal(), (current) => addQuestion(current, 'abstract', TAKEAWAY))
    const none = applyPatch(one, (current) => removeQuestion(current, 'abstract', 'fld_take'))

    expect(none.fields).toEqual([])
    expect(none.routing).toEqual({ rules: [], defaultTrackId: undefined })
    expect(none.entityType).toBe('submission')
  })
})

describe('the other question-list edits, through the same updater', () => {
  it('removes a question and the routing rules that fire on it', () => {
    const withRouting = draft({
      fields: [TITLE, AUDIENCE],
      routing: {
        rules: [
          { when: { fieldId: 'fld_audience', op: 'eq', value: 'beginner' }, trackId: 'recA' },
        ],
        defaultTrackId: 'recA',
      },
    })

    const next = applyPatch(withRouting, (current) =>
      removeQuestion(current, 'abstract', 'fld_audience'),
    )

    expect(ids(next.fields)).toEqual(['fld_title'])
    expect(next.routing.rules).toEqual([])
  })

  it('refuses to remove a locked system field, exactly as removeField does', () => {
    const next = applyPatch(draft(), (current) => removeQuestion(current, 'abstract', 'fld_title'))

    expect(ids(next.fields)).toEqual(['fld_title'])
  })

  it('patches and moves the question named, leaving the rest of the draft alone', () => {
    const two = applyPatch(draft(), (current) => addQuestion(current, 'abstract', TAKEAWAY))
    const required = applyPatch(two, (current) =>
      patchQuestion(current, 'abstract', 'fld_take', { required: false }),
    )
    const moved = applyPatch(required, (current) =>
      moveQuestion(current, 'abstract', 'fld_take', -1),
    )

    expect(ids(questionsOf(moved, 'abstract'))).toEqual(['fld_take', 'fld_title'])
    expect(moved.fields.find((field) => field.id === 'fld_take')?.required).toBe(false)
    expect(moved.name).toBe('DevFlow Conf 2027 CFP')
  })
})

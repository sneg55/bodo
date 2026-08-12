// The speaker's body edit: who may save, what gets validated, and where it lands.
//
// The policy itself is `submissionEditPermission` (tests/portal-edit-mode.test.ts). What
// is tested here is that the SAVE re-derives that policy from the record rather than
// trusting the page, because BUILD_SPEC 4 is explicit that a disabled input is not a
// security boundary: every case below posts a well-formed payload and the only thing
// deciding the outcome is the submission's status and the form's state.

import { describe, expect, it } from 'vitest'

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { answersForForm } from '@/features/portal/submission-columns'
import {
  type BodyEditResult,
  bodyEditPermission,
  parsePostedAnswers,
  prepareBodyEdit,
} from '@/features/portal/submission-edit'
import type { SubmissionWithParticipants } from '@/types/domain'
import type { Form } from '@/types/forms'

import { field, form, submission } from './helpers/portal-fakes'

const NOW = new Date('2026-08-08T12:00:00.000Z')

/**
 * One registry-keyed question per typed column that a form can collect, one local
 * question with no key, and one conditional question. Every assertion below about the
 * storage split or about hidden answers needs several of them present at once.
 */
const CFP: Form = form({
  closeDate: '2026-09-15T23:59:00.000Z',
  fields: [
    field({ id: 'fld_title', label: 'Title', registryKey: 'title' }),
    field({ id: 'fld_desc', label: 'Description', type: 'wysiwyg', registryKey: 'description' }),
    field({
      id: 'fld_format',
      label: 'Format',
      type: 'select',
      required: true,
      registryKey: 'format',
      options: [
        { value: 'talk', label: 'Talk' },
        { value: 'workshop', label: 'Workshop' },
      ],
    }),
    field({
      id: 'fld_lab',
      label: 'Lab setup requirements',
      showIf: { fieldId: 'fld_format', op: 'eq', value: 'workshop' },
    }),
    field({ id: 'fld_notes', label: 'Anything else' }),
  ],
})

const GOOD_ANSWERS = {
  fld_title: 'Evaluating agents',
  fld_desc: '<p>Bring a laptop.</p>',
  fld_format: 'talk',
  fld_notes: 'Prefer the morning',
}

function prepare(
  overrides: Partial<SubmissionWithParticipants> = {},
  answers: Record<string, unknown> = GOOD_ANSWERS,
  cfp: Form | undefined = CFP,
): BodyEditResult {
  return prepareBodyEdit({
    submission: submission({ status: 'draft', ...overrides }),
    form: cfp,
    now: NOW,
    answers,
  })
}

function refusalId(run: () => unknown): string | undefined {
  try {
    run()
    return undefined
  } catch (error) {
    return isAppError(error) ? error.id : undefined
  }
}

function prepared(result: BodyEditResult) {
  if (!result.ok) {
    throw new Error(`unexpected problems: ${result.problems.map((p) => p.message).join('; ')}`)
  }
  return result.prepared
}

describe('bodyEditPermission', () => {
  it('treats a submission with no form as frozen, because there is no form to edit through', () => {
    const permission = bodyEditPermission({ status: 'draft', form: undefined, now: NOW })
    expect(permission.bodyEditable).toBe(false)
  })

  it('reads the form state at the instant of the save, not at page render', () => {
    const afterClose = new Date('2026-10-01T00:00:00.000Z')
    expect(bodyEditPermission({ status: 'draft', form: CFP, now: NOW }).bodyEditable).toBe(true)
    expect(bodyEditPermission({ status: 'draft', form: CFP, now: afterClose }).bodyEditable).toBe(
      false,
    )
  })
})

describe('prepareBodyEdit refusals', () => {
  it('refuses a save against an accepted submission even though the payload is valid', () => {
    // The frozen case. Nothing about this request is malformed: it is refused on the
    // record's own status, server-side, so a client that never rendered the read-only
    // page still cannot rewrite an abstract the organizer has already agreed to.
    expect(refusalId(() => prepare({ status: 'accepted' }))).toBe(ErrorIds.SUB_BODY_LOCKED)
  })

  it('refuses a declined submission for the same reason', () => {
    expect(refusalId(() => prepare({ status: 'declined' }))).toBe(ErrorIds.SUB_BODY_LOCKED)
  })

  it('refuses once the form has closed, even for a draft', () => {
    const closed = form({ ...CFP, closeDate: '2026-07-01T00:00:00.000Z' })
    expect(refusalId(() => prepare({ status: 'draft' }, GOOD_ANSWERS, closed))).toBe(
      ErrorIds.SUB_BODY_LOCKED,
    )
  })

  it('refuses a manual submission, which has no form to validate against', () => {
    const manual = () =>
      prepareBodyEdit({
        submission: submission({ status: 'draft', formId: undefined, source: 'manual' }),
        form: undefined,
        now: NOW,
        answers: GOOD_ANSWERS,
      })
    expect(refusalId(manual)).toBe(ErrorIds.SUB_BODY_LOCKED)
  })

  it('returns problems rather than throwing when a visible required answer is missing', () => {
    const result = prepare({ status: 'draft' }, { ...GOOD_ANSWERS, fld_format: '' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map((problem) => problem.fieldId)).toContain('fld_format')
  })

  it('does not validate a question the condition hides', () => {
    // `fld_lab` is required only while Format is workshop. A talk must save without it.
    const result = prepare({ status: 'draft' }, { ...GOOD_ANSWERS, fld_lab: '' })
    expect(result.ok).toBe(true)
  })
})

describe('prepareBodyEdit success', () => {
  it('saves a draft on an open form, with no admin alert owed', () => {
    const result = prepared(prepare({ status: 'draft' }))
    expect(result.permission.mode).toBe('full')
    // A draft that has never been submitted is not news: see `alertsAdminsOnSave`.
    expect(result.permission.alertsAdminsOnSave).toBe(false)
    expect(result.edit.title).toBe('Evaluating agents')
  })

  it('saves a submitted submission while the form still accepts updates, and owes an alert', () => {
    const result = prepared(prepare({ status: 'pending' }))
    expect(result.permission.mode).toBe('body_updates')
    expect(result.permission.alertsAdminsOnSave).toBe(true)
  })

  it('splits typed columns from answersJson extras', () => {
    const result = prepared(prepare({ status: 'draft' }))
    // Title and Format carry registry keys the registry gives columns to, so they are
    // sortable in the Abstracts table. Description is keyed but not a column, and
    // `fld_notes` was never in the registry at all, so both stay in the blob.
    expect(result.edit.title).toBe('Evaluating agents')
    expect(result.edit.format).toBe('talk')
    expect(Object.keys(result.edit.answers).sort()).toEqual(['fld_desc', 'fld_notes'])
    expect(result.edit.answers.fld_notes).toBe('Prefer the morning')
  })

  it('never stores a hidden field value, however it got into the payload', () => {
    // Format is a talk, so the workshop-only question was not asked. A stale answer left
    // in the payload must not be filed as one the speaker gave.
    const result = prepared(
      prepare({ status: 'draft' }, { ...GOOD_ANSWERS, fld_lab: 'Docker and 16GB' }),
    )
    expect(result.edit.answers.fld_lab).toBeUndefined()
  })

  it('keeps the record title when the form asks no Title question', () => {
    const untitled = form({ ...CFP, fields: CFP.fields.filter((f) => f.id !== 'fld_title') })
    const result = prepared(
      prepare({ status: 'draft', title: 'The stored title' }, GOOD_ANSWERS, untitled),
    )
    // `submissionEditFields` always writes the title column, so an edit with no Title
    // question has to carry the existing one or the save would blank it.
    expect(result.edit.title).toBe('The stored title')
  })

  it('leaves an untouched typed column alone rather than clearing it', () => {
    const noFormatAnswer = { fld_title: 'Evaluating agents', fld_format: 'talk' }
    const result = prepared(
      prepare({ status: 'draft', level: 'intermediate' }, noFormatAnswer, CFP),
    )
    // `level` was never asked, so it is absent from the edit, which is what leaves the
    // column as it stands. Present-and-undefined would be indistinguishable in the write.
    expect('level' in result.edit).toBe(false)
  })

  it('does not turn a cleared number answer into a zero', () => {
    const withCredits = form({
      ...CFP,
      fields: [
        field({ id: 'fld_ceu', label: 'CEU credits', type: 'number', registryKey: 'ceuCredits' }),
      ],
    })
    const result = prepared(
      prepare({ status: 'draft', ceuCredits: 2 }, { fld_ceu: '' }, withCredits),
    )
    // `Number('')` is 0 and finite, so a cleared credits box used to write 0 credits.
    expect(result.edit.ceuCredits).toBeUndefined()
  })
})

describe('answersForForm', () => {
  it('reassembles the seed for the edit form out of both halves of storage', () => {
    const seeded = answersForForm(
      CFP.fields,
      submission({
        title: 'From the column',
        format: 'workshop',
        answers: { fld_notes: 'From the blob' },
      }),
    )
    expect(seeded).toMatchObject({
      fld_title: 'From the column',
      fld_format: 'workshop',
      fld_notes: 'From the blob',
    })
  })

  it('renders a number column as text, since that is the shape a form post carries', () => {
    const withCredits = form({
      ...CFP,
      fields: [
        field({ id: 'fld_ceu', label: 'CEU credits', type: 'number', registryKey: 'ceuCredits' }),
      ],
    })
    expect(answersForForm(withCredits.fields, submission({ ceuCredits: 1.5 }))).toEqual({
      fld_ceu: '1.5',
    })
  })

  it('treats an empty tag list as unanswered, since the column is never absent', () => {
    const tagged = form({
      ...CFP,
      fields: [field({ id: 'fld_tags', label: 'Tags', type: 'multiselect', registryKey: 'tags' })],
    })
    expect(answersForForm(tagged.fields, submission({ tagIds: [] }))).toEqual({})
    expect(answersForForm(tagged.fields, submission({ tagIds: ['recTag1'] }))).toEqual({
      fld_tags: ['recTag1'],
    })
  })

  it('leaves an unanswered question out, so the control renders empty', () => {
    expect(
      answersForForm(CFP.fields, submission({ title: 'T', format: undefined, answers: {} })),
    ).toEqual({ fld_title: 'T' })
  })
})

describe('parsePostedAnswers', () => {
  it('reads the answers the client posted as one JSON value', () => {
    expect(parsePostedAnswers('{"fld_title":"Ada"}')).toEqual({ fld_title: 'Ada' })
  })

  it('refuses anything that is not an object of answers', () => {
    // The action is an open POST target, so this is the only shape check there is.
    expect(refusalId(() => parsePostedAnswers('[]'))).toBe(ErrorIds.SUB_VALIDATION_FAIL)
    expect(refusalId(() => parsePostedAnswers('null'))).toBe(ErrorIds.SUB_VALIDATION_FAIL)
    expect(refusalId(() => parsePostedAnswers('not json'))).toBe(ErrorIds.SUB_VALIDATION_FAIL)
  })
})

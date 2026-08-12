// The organizer's title/abstract edit.
//
// Two things here are worth pinning rather than trusting to review, and both are the kind
// of bug that looks like nothing in a diff. `answersJson` is REPLACED rather than merged
// by the writer, so an edit that forgets to carry the other answers through deletes them
// silently. And the change list is what the revision history is built from, so a wrong
// one writes a permanent record of something that did not happen.

import { describe, expect, it } from 'vitest'

import {
  abstractAnswerKey,
  abstractField,
  formatRevisionStamp,
  prepareContentEdit,
  restorePayload,
  storedAbstract,
} from '@/features/review/content-edit'
import type { SubmissionWithParticipants } from '@/types/domain'
import type { Form, FormField } from '@/types/forms'

import { syncErrorIdOf } from './helpers/auth-fakes'

const ABSTRACT: FormField = {
  id: 'f_desc',
  type: 'wysiwyg',
  label: 'Description',
  required: true,
  registryKey: 'description',
}

const OTHER: FormField = { id: 'f_notes', type: 'text', label: 'Notes', required: false }

function form(fields: readonly FormField[] = [ABSTRACT, OTHER]): Form {
  return {
    id: 'form1',
    eventId: 'ev1',
    name: 'Call for Speakers',
    publicId: 'pub1',
    kind: 'cfp',
    entityKind: 'abstracts',
    participantsEnabled: false,
    status: 'published',
    fields,
    participantFields: [],
    routing: { rules: [] },
    roles: [],
    crossFieldLimits: [],
    allowMultipleDrafts: false,
    autoRedirectToPortal: false,
    confirmationEmailEnabled: false,
    adminAlertOnNew: [],
    adminAlertOnUpdate: [],
  }
}

function submission(overrides: Partial<SubmissionWithParticipants> = {}) {
  return {
    id: 'sub1',
    eventId: 'ev1',
    formId: 'form1',
    submitterId: 'spk1',
    code: 'SESS-1',
    title: 'Agents that ship',
    status: 'pending',
    source: 'form',
    reviewRequired: true,
    answers: { f_desc: 'The original abstract.', f_notes: 'Prefer the morning' },
    tagIds: [],
    scheduleStatus: 'unscheduled',
    contentStatus: 'not_submitted',
    participants: [],
    ...overrides,
  } as SubmissionWithParticipants
}

describe('abstractField', () => {
  it('finds the abstract by registry key, never by label', () => {
    // A local question an organizer happened to call "Description" is structurally
    // identical to the registry's, and matching on the label would write one question's
    // answer into another's storage.
    const decoy: FormField = { id: 'f_fake', type: 'text', label: 'Description', required: false }

    expect(abstractField(form([decoy, ABSTRACT]))?.id).toBe('f_desc')
  })

  it('is undefined for a form that asks no abstract, and for no form at all', () => {
    expect(abstractField(form([OTHER]))).toBeUndefined()
    expect(abstractField(undefined)).toBeUndefined()
  })
})

describe('abstractAnswerKey', () => {
  it('falls back to the registry key when no form field holds the abstract', () => {
    // The gap CNT-09 was scored on. A session entered through Add Abstract has no form,
    // so this used to resolve to nothing and the editor rendered a Title box on its own.
    expect(abstractAnswerKey(ABSTRACT)).toBe('f_desc')
    expect(abstractAnswerKey(undefined)).toBe('description')
  })
})

describe('storedAbstract', () => {
  it('reads the answer under the field id', () => {
    expect(storedAbstract(submission(), ABSTRACT)).toBe('The original abstract.')
  })

  it('reads the manual key for a session that came through no form', () => {
    // The same key `manual-abstract.ts` writes Add Abstract's body to. Seeding the editor
    // from '' here instead would make the first save wipe a body nobody was shown.
    const manual = submission({ formId: undefined, answers: { description: 'Typed by hand.' } })

    expect(storedAbstract(manual, abstractField(undefined))).toBe('Typed by hand.')
  })

  it('is empty rather than undefined when nothing is stored', () => {
    expect(storedAbstract(submission({ answers: {} }), ABSTRACT)).toBe('')
    expect(storedAbstract(submission(), undefined)).toBe('')
  })
})

describe('prepareContentEdit', () => {
  it('carries every other answer through, because the writer replaces the blob', () => {
    // The dangerous one. `submissionEditFields` replaces `answersJson` rather than merging
    // into it, so an edit that passed only the abstract would delete `f_notes` for good.
    const { edit } = prepareContentEdit({
      submission: submission(),
      form: form(),
      title: 'Agents that ship',
      abstract: 'A better abstract.',
    })

    expect(edit.answers).toEqual({ f_desc: 'A better abstract.', f_notes: 'Prefer the morning' })
  })

  it('reports one change per field actually altered', () => {
    const { changes } = prepareContentEdit({
      submission: submission(),
      form: form(),
      title: 'Agents that actually ship',
      abstract: 'A better abstract.',
    })

    expect(changes).toEqual([
      { field: 'Title', from: 'Agents that ship', to: 'Agents that actually ship' },
      { field: 'Abstract', from: 'The original abstract.', to: 'A better abstract.' },
    ])
  })

  it('reports nothing when Save is pressed with nothing altered', () => {
    // An organizer who opens the editor and closes it must not leave a history entry
    // claiming they changed something.
    const { changes } = prepareContentEdit({
      submission: submission(),
      form: form(),
      title: 'Agents that ship',
      abstract: 'The original abstract.',
    })

    expect(changes).toEqual([])
  })

  it('treats surrounding whitespace as no change', () => {
    const { changes, edit } = prepareContentEdit({
      submission: submission(),
      form: form(),
      title: '  Agents that ship  ',
      abstract: 'The original abstract.',
    })

    expect(changes).toEqual([])
    expect(edit.title).toBe('Agents that ship')
  })

  it('records clearing the abstract, rather than skipping it', () => {
    // "400 words to nothing" is exactly the change somebody goes looking for later.
    const { changes } = prepareContentEdit({
      submission: submission(),
      form: form(),
      title: 'Agents that ship',
      abstract: '',
    })

    expect(changes).toEqual([{ field: 'Abstract', from: 'The original abstract.', to: '' }])
  })

  it('stores the abstract under the registry key when the form asks no such question', () => {
    // This is the CNT-09 defect, at the level it actually lived. The value used to be
    // discarded here on the reasoning that a formless session had nowhere to put it, and
    // the editor therefore hid the control: on the seed's hand-entered keynote the
    // abstract could not be edited at all. The key is the one Add Abstract already writes.
    const { edit, changes } = prepareContentEdit({
      submission: submission({ formId: undefined, answers: { f_notes: 'Prefer the morning' } }),
      form: undefined,
      title: 'Agents that ship',
      abstract: 'Written by the chair.',
    })

    expect(edit.answers).toEqual({
      f_notes: 'Prefer the morning',
      description: 'Written by the chair.',
    })
    expect(changes).toEqual([{ field: 'Abstract', from: '', to: 'Written by the chair.' }])
  })

  it('refuses an empty title', () => {
    expect(
      syncErrorIdOf(() =>
        prepareContentEdit({
          submission: submission(),
          form: form(),
          title: '   ',
          abstract: 'x',
        }),
      ),
    ).toBe('E_SUB_003')
  })

  it('refuses a title over the column cap', () => {
    expect(
      syncErrorIdOf(() =>
        prepareContentEdit({
          submission: submission(),
          form: form(),
          title: 'x'.repeat(256),
          abstract: 'x',
        }),
      ),
    ).toBe('E_SUB_003')
  })
})

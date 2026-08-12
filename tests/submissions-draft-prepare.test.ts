// Save-and-finish-later, on the pure side.
//
// CFP-07: the wizard preserved work in localStorage and said so, but the draft was
// "not bound to the submitter's account and would not survive a different browser or
// device". `prepareDraft` is the half of the fix that decides what a draft row contains;
// `draft-write.ts` is the half that writes it.
//
// The interesting property is the one asymmetry with `prepareSubmission`: a draft may be
// MISSING answers and may not be full of BAD ones, because the same row is what the
// portal's Submit later flips to `pending`.

import { describe, expect, it } from 'vitest'

import { ProblemCodes } from '@/features/forms/validate'
import {
  hasDraftContent,
  identityProblems,
  prepareDraft,
} from '@/features/submissions/draft-prepare'
import type { Form } from '@/types/forms'

import { CFP_FORM, cfpPayload } from './helpers/cfp-form'

function expectDraft(result: ReturnType<typeof prepareDraft>) {
  if (!result.ok) {
    throw new Error(`unexpected problems: ${result.problems.map((p) => p.message).join('; ')}`)
  }
  return result.prepared
}

/** Only a title typed, which is the least the acceptance criterion asks for. */
const TITLE_ONLY = { f_title: 'Agents that ship' }

describe('prepareDraft', () => {
  it('saves a draft with nothing but a title', () => {
    // The seeded form marks Format required and it is not answered here. A submit would
    // be refused for that; a draft is the state of not having answered it yet.
    const prepared = expectDraft(
      prepareDraft({ form: CFP_FORM, payload: cfpPayload({ answers: TITLE_ONLY }) }),
    )

    expect(prepared.title).toBe('Agents that ship')
    expect(prepared.columns.format).toBeUndefined()
  })

  it('still refuses an answer that is too long', () => {
    // Not pedantry: the draft row IS the submitted row, so a value stored now that the
    // submit would reject later strands the speaker's work in a record they cannot
    // submit. Only `REQUIRED` is forgiven.
    const capped: Form = {
      ...CFP_FORM,
      fields: CFP_FORM.fields.map((field) =>
        field.id === 'f_title' ? { ...field, maxLen: 10 } : field,
      ),
    }
    const result = prepareDraft({
      form: capped,
      payload: cfpPayload({ answers: { f_title: 'A title well past the cap' } }),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map((problem) => problem.code)).toContain(ProblemCodes.MAX_LEN)
  })

  it('titles an untitled draft rather than refusing it', () => {
    const prepared = expectDraft(
      prepareDraft({ form: CFP_FORM, payload: cfpPayload({ answers: { f_notes: 'Mornings' } }) }),
    )

    expect(prepared.title).toBe('Untitled submission')
    expect(prepared.answers).toEqual({ f_notes: 'Mornings' })
  })

  it('strips an answer to a question the speaker was not shown', () => {
    // Same sanitizer as the submit path: f_lab is workshop-only, so a payload carrying it
    // beside `talk` must not put it in the row.
    const prepared = expectDraft(
      prepareDraft({
        form: CFP_FORM,
        payload: cfpPayload({ answers: { ...TITLE_ONLY, f_format: 'talk', f_lab: 'left over' } }),
      }),
    )

    expect(prepared.answers.f_lab).toBeUndefined()
  })

  it('files the draft under the same track the submit would have chosen', () => {
    // The whole reason `resolveTrackId` is its own module. A draft that routes one way and
    // a submit that routes another is the CFP-06 defect with an extra step.
    const prepared = expectDraft(
      prepareDraft({
        form: CFP_FORM,
        payload: cfpPayload({ answers: { ...TITLE_ONLY, f_format: 'talk' } }),
      }),
    )

    expect(prepared.trackId).toBe('trkTalk')
  })

  it('lets a speaker-answered Track outrank the rule, as the submit path does', () => {
    // With OPTIONS, because `track` writes a link column: `splitAnswers` resolves the answer
    // against the question's own option list rather than casting it into a record id, so a
    // Track question that offers nothing can vouch for no answer.
    const asks: Form = {
      ...CFP_FORM,
      fields: [
        ...CFP_FORM.fields,
        {
          id: 'f_track',
          type: 'select',
          label: 'Track',
          required: false,
          registryKey: 'track',
          options: [{ value: 'trkChosen', label: 'Platform & Infra' }],
        },
      ],
    }
    const prepared = expectDraft(
      prepareDraft({
        form: asks,
        payload: cfpPayload({
          answers: { ...TITLE_ONLY, f_format: 'talk', f_track: 'trkChosen' },
        }),
      }),
    )

    expect(prepared.trackId).toBe('trkChosen')
  })

  it('stamps what the row will be worth once it is submitted', () => {
    // Section 5.1b decides this at creation and never re-derives it, and the portal's
    // Submit only moves the status, so a draft that stamps it wrong stays wrong.
    expect(
      expectDraft(prepareDraft({ form: CFP_FORM, payload: cfpPayload() })).reviewRequired,
    ).toBe(true)
    const sessions: Form = { ...CFP_FORM, entityKind: 'sessions' }
    expect(
      expectDraft(prepareDraft({ form: sessions, payload: cfpPayload() })).reviewRequired,
    ).toBe(false)
  })
})

describe('hasDraftContent', () => {
  it('refuses a draft of nothing', () => {
    // A public endpoint must not create a Speakers row and a Submissions row for a
    // visitor who typed an address and left.
    expect(hasDraftContent({ answers: {} })).toBe(false)
    expect(hasDraftContent({ title: '   ', answers: {} })).toBe(false)
  })

  it('accepts a title alone, or an answer alone', () => {
    expect(hasDraftContent({ title: 'Agents that ship', answers: {} })).toBe(true)
    expect(hasDraftContent({ answers: { f_notes: 'Mornings' } })).toBe(true)
  })
})

describe('identityProblems', () => {
  it('requires an address, because it is what the draft is bound to', () => {
    expect(identityProblems('  ').map((problem) => problem.code)).toEqual([ProblemCodes.REQUIRED])
  })

  it('refuses one that is not an address', () => {
    expect(identityProblems('ada').map((problem) => problem.code)).toEqual([
      ProblemCodes.EMAIL_INVALID,
    ])
  })

  it('accepts an ordinary address, trimmed and in any case', () => {
    expect(identityProblems('  Ada@Example.com ')).toEqual([])
  })
})

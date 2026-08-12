// The refusals and the reported problems.
//
// Two different mechanisms, and the split is the point. A closed form and a reached cap
// are conditions of the endpoint, so they throw an AppError with an id: there is no
// control to attach a message to. A bad answer is a value, so it comes back as a Problem
// attributed to its field or its participant, all of them at once, because a filled-in
// form that reports one mistake per round trip is how a speaker gives up.

import { describe, expect, it } from 'vitest'

import { ErrorIds } from '@/constants/errorIds'
import { ProblemCodes } from '@/features/forms/validate'
import { prepareSubmission } from '@/features/submissions/prepare'
import type { Form } from '@/types/forms'

import {
  CFP_FORM,
  cfpPayload,
  NOW,
  prepareCfp,
  soloSpeaker,
  thrownErrorId,
} from './helpers/cfp-form'

function problemsOf(result: ReturnType<typeof prepareCfp>) {
  if (result.ok) throw new Error('expected problems, got a prepared submission')
  return result.problems
}

describe('prepareSubmission refuses', () => {
  it('a form past its close date', () => {
    expect(
      thrownErrorId(() =>
        prepareSubmission({
          form: CFP_FORM,
          eventId: 'ev1',
          payload: cfpPayload(),
          now: new Date('2026-09-16T00:00:00.000Z'),
          existingCount: 0,
          limit: 3,
        }),
      ),
    ).toBe(ErrorIds.SUB_FORM_CLOSED)
  })

  it('a draft form even when the close date is in the future', () => {
    expect(thrownErrorId(() => prepareCfp({ ...CFP_FORM, status: 'draft' }))).toBe(
      ErrorIds.SUB_FORM_CLOSED,
    )
  })

  it('a submitter who is at the cap, while allowing one who is under it', () => {
    expect(thrownErrorId(() => prepareCfp(CFP_FORM, {}, 3))).toBe(ErrorIds.SUB_LIMIT_REACHED)
    expect(prepareCfp(CFP_FORM, {}, 2).ok).toBe(true)
  })

  it('nothing on count when neither the form nor the event set a cap', () => {
    const result = prepareSubmission({
      form: { ...CFP_FORM, submissionLimit: undefined },
      eventId: 'ev1',
      payload: cfpPayload(),
      now: NOW,
      existingCount: 99,
      limit: undefined,
    })
    expect(result.ok).toBe(true)
  })
})

describe('prepareSubmission reports', () => {
  it('a visible required answer that is missing', () => {
    const problems = problemsOf(prepareCfp(CFP_FORM, { answers: { f_format: 'talk' } }))
    expect(problems.map((problem) => problem.fieldId)).toContain('f_title')
  })

  it('the conditional field only once its condition holds', () => {
    expect(prepareCfp(CFP_FORM, { answers: { f_title: 'T', f_format: 'talk' } }).ok).toBe(true)

    const problems = problemsOf(
      prepareCfp(CFP_FORM, { answers: { f_title: 'T', f_format: 'workshop' } }),
    )
    expect(problems.map((problem) => problem.fieldId)).toContain('f_lab')
  })

  it('an answer that is not one of the declared options', () => {
    const problems = problemsOf(
      prepareCfp(CFP_FORM, { answers: { f_title: 'T', f_format: 'keynote' } }),
    )
    expect(problems.map((problem) => problem.code)).toContain(ProblemCodes.OPTION_INVALID)
  })

  it('every mistake at once rather than stopping at the first', () => {
    const problems = problemsOf(prepareCfp(CFP_FORM, { answers: {} }))
    expect(problems.length).toBeGreaterThan(1)
  })

  it('a participant with no email, attributed to their own row', () => {
    const problems = problemsOf(
      prepareCfp(CFP_FORM, { participants: [soloSpeaker({ email: '   ' })] }),
    )
    expect(problems.some((problem) => problem.participantId === 'p1')).toBe(true)
  })

  it('a role the organizer never enabled', () => {
    const problems = problemsOf(
      prepareCfp(CFP_FORM, { participants: [soloSpeaker({ role: 'moderator' })] }),
    )
    expect(problems.map((problem) => problem.code)).toContain(ProblemCodes.ROLE_NOT_ENABLED)
  })

  it('a cast with two primaries', () => {
    const problems = problemsOf(
      prepareCfp(CFP_FORM, {
        participants: [
          soloSpeaker(),
          soloSpeaker({ key: 'p2', role: 'co_speaker', email: 'bruno@example.com' }),
        ],
      }),
    )
    expect(problems.map((problem) => problem.code)).toContain(ProblemCodes.PRIMARY_DUPLICATE)
  })

  it('a role over its maximum', () => {
    const problems = problemsOf(
      prepareCfp(CFP_FORM, {
        participants: [
          soloSpeaker(),
          soloSpeaker({ key: 'p2', isPrimary: false, email: 'bruno@example.com' }),
        ],
      }),
    )
    expect(problems.map((problem) => problem.code)).toContain(ProblemCodes.ROLE_MAX)
  })

  it('a perParticipant combined limit measured against one cast member', () => {
    const form: Form = {
      ...CFP_FORM,
      crossFieldLimits: [{ fieldIds: ['p_bio'], maxLen: 20, perParticipant: true }],
    }
    const problems = problemsOf(
      prepareCfp(form, {
        participants: [soloSpeaker({ answers: { p_bio: 'x'.repeat(25) } })],
      }),
    )
    expect(problems.map((problem) => problem.code)).toContain(ProblemCodes.CROSS_FIELD_MAX_LEN)
  })

  it('a submission-level combined limit against the submission answers', () => {
    const form: Form = {
      ...CFP_FORM,
      crossFieldLimits: [{ fieldIds: ['f_title', 'f_notes'], maxLen: 10, perParticipant: false }],
    }
    const problems = problemsOf(prepareCfp(form))
    expect(problems.map((problem) => problem.code)).toContain(ProblemCodes.CROSS_FIELD_MAX_LEN)
  })
})

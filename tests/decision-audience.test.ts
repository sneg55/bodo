// CFP-14's second half. The send (decisions.ts) used to pick a decline's recipient by
// `isPrimary`, and the preview (decision-preview.ts) picked it by `submitterId`. Those
// disagree whenever the primary presenter is not the account that filed the CFP, which
// the codebase documents as a real, intended case (submit-cast.ts). Pinned here at the
// one shared function both files now call, so the two can no longer drift apart again.

import { describe, expect, it } from 'vitest'

import { decisionAudience } from '@/features/submissions/decision-audience'

const submitter = { speakerId: 'recSpk1', isPrimary: false }
const coPresenter = { speakerId: 'recSpk2', isPrimary: true }
const participants = [submitter, coPresenter]

describe('an accept', () => {
  it('mails every participant, submitter and co-presenter alike', () => {
    expect(decisionAudience(participants, 'accept', 'recSpk1')).toEqual(participants)
  })
})

describe('a decline', () => {
  it('mails the submitter alone, even when a co-presenter is flagged primary', () => {
    expect(decisionAudience(participants, 'decline', 'recSpk1')).toEqual([submitter])
  })

  it('mails nobody when the submitter has been removed from the roster', () => {
    expect(decisionAudience([coPresenter], 'decline', 'recSpk1')).toEqual([])
  })

  it('never falls back to isPrimary: a submitter who is also primary is still matched by id', () => {
    const submitterIsPrimary = { speakerId: 'recSpk1', isPrimary: true }
    expect(decisionAudience([submitterIsPrimary, coPresenter], 'decline', 'recSpk1')).toEqual([
      submitterIsPrimary,
    ])
  })
})

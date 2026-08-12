// Which submissions a speaker sees, and in what order.

import { describe, expect, it } from 'vitest'

import {
  ownSubmissions,
  sortNewestFirst,
  speakerOwnsSubmission,
  submissionCardTitle,
} from '@/features/portal/own-submissions'

import { CO_SPEAKER, OWNER, participant, STRANGER, submission } from './helpers/portal-fakes'

describe('speakerOwnsSubmission', () => {
  it('counts the submitter and everyone on the roster', () => {
    const row = submission({}, [
      participant({ speakerId: OWNER }),
      participant({ speakerId: CO_SPEAKER, role: 'co_speaker', isPrimary: false, sortOrder: 2 }),
    ])

    expect(speakerOwnsSubmission(row, OWNER)).toBe(true)
    expect(speakerOwnsSubmission(row, CO_SPEAKER)).toBe(true)
    expect(speakerOwnsSubmission(row, STRANGER)).toBe(false)
  })

  it('counts a submitter who is not on the roster', () => {
    // An organizer can enter a submission on someone's behalf and forget the cast row.
    expect(speakerOwnsSubmission(submission({ submitterId: OWNER }, []), OWNER)).toBe(true)
  })
})

describe('ownSubmissions', () => {
  it('keeps only the caller own rows', () => {
    const mine = submission({ id: 'a', code: 'SESS-1' }, [participant({ speakerId: OWNER })])
    const theirs = submission({ id: 'b', code: 'SESS-2', submitterId: STRANGER }, [
      participant({ speakerId: STRANGER }),
    ])

    expect(ownSubmissions([mine, theirs], OWNER).map((row) => row.id)).toEqual(['a'])
  })
})

describe('sortNewestFirst', () => {
  it('sorts by submittedAt descending', () => {
    const older = submission({ id: 'older', submittedAt: '2026-08-01T00:00:00.000Z' })
    const newer = submission({ id: 'newer', submittedAt: '2026-08-05T00:00:00.000Z' })

    expect(sortNewestFirst([older, newer]).map((row) => row.id)).toEqual(['newer', 'older'])
  })

  it('puts an unsubmitted draft above everything submitted', () => {
    const draft = submission({ id: 'draft', status: 'draft', submittedAt: undefined })
    const sent = submission({ id: 'sent', submittedAt: '2026-08-05T00:00:00.000Z' })

    expect(sortNewestFirst([sent, draft]).map((row) => row.id)).toEqual(['draft', 'sent'])
  })

  it('breaks ties on the code numerically, so SESS-10 outranks SESS-9', () => {
    const nine = submission({ id: 'nine', code: 'SESS-9', submittedAt: undefined })
    const ten = submission({ id: 'ten', code: 'SESS-10', submittedAt: undefined })

    expect(sortNewestFirst([nine, ten]).map((row) => row.id)).toEqual(['ten', 'nine'])
  })

  it('does not mutate the array it was given', () => {
    const rows = [
      submission({ id: 'a', submittedAt: '2026-08-01T00:00:00.000Z' }),
      submission({ id: 'b', submittedAt: '2026-08-09T00:00:00.000Z' }),
    ]
    sortNewestFirst(rows)

    expect(rows.map((row) => row.id)).toEqual(['a', 'b'])
  })
})

describe('submissionCardTitle', () => {
  it('renders the code and the title with the captured dash separator', () => {
    // Ref 17 shows `SESS-4 - sd`. The separator is transcribed, not chosen.
    expect(submissionCardTitle({ code: 'SESS-4', title: 'sd' })).toBe('SESS-4 - sd')
  })
})

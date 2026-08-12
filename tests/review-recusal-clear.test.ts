// Turning the Conflict of interest switch back OFF.
//
// Written to settle a reported defect rather than to fix one: an evaluation run observed the
// switch revert to unchecked while the round's reviewer-progress list still showed a
// `1 recused` badge for that reviewer, and recorded it as suggestive without re-checking the
// server. It is not a write bug, and these are the two places a `false` could be swallowed
// on the way to Airtable, both pinned so it cannot become one:
//
//   1. `mergeReviewDraft`, where `??` rather than `||` is what keeps a deliberate `false`
//      from falling through to the value it is replacing.
//   2. `reviewFields`, where `compact` drops a key whose value is `undefined` and MUST NOT
//      drop one whose value is `false`. A dropped key leaves the Airtable checkbox ticked,
//      which is exactly the symptom that was reported.
//
// What the run actually saw is the admin's progress panel being a server render that the
// reviewer's autosave does not re-request: the badge is stale until the page is loaded
// again, and the stored review is already clear.

import { describe, expect, it } from 'vitest'

import { mergeReviewDraft } from '@/features/review/review-draft'
import { reviewerProgress } from '@/features/review/reviewer-progress'
import { COL } from '@/services/airtable/tables'
import { reviewFields } from '@/services/airtable/to-fields-review'

describe('clearing a recusal', () => {
  it('does not fall through to the recusal it is replacing', () => {
    const recused = mergeReviewDraft(
      { scores: {}, notes: {}, recused: false, comment: '' },
      { recused: true },
    )

    expect(mergeReviewDraft(recused, { recused: false }).recused).toBe(false)
    // A patch that says nothing about the recusal leaves it alone, which is what the `??`
    // is there for: every keystroke in the comment box is such a patch.
    expect(mergeReviewDraft(recused, { comment: 'typing' }).recused).toBe(true)
  })

  it('SENDS the false rather than omitting the column', () => {
    const fields = reviewFields({
      submissionId: 'recSub1',
      roundId: 'recRound1',
      reviewerId: 'recUser1',
      scores: {},
      recused: false,
      updatedAt: '2026-08-10T00:00:00.000Z',
    })

    // Present, and false. An omitted key is not "no change" to a reviewer who just
    // unticked the box, it is the tick staying on the record forever.
    expect(Object.hasOwn(fields, COL.recused)).toBe(true)
    expect(fields[COL.recused]).toBe(false)

    // And the assertion above can fail: `compact` really does drop the key, for the value
    // that means "leave this column alone".
    const untouched = reviewFields({
      submissionId: 'recSub1',
      roundId: 'recRound1',
      reviewerId: 'recUser1',
      scores: {},
      updatedAt: '2026-08-10T00:00:00.000Z',
    })
    expect(Object.hasOwn(untouched, COL.recused)).toBe(false)
  })

  it('drops the reviewer out of the recused count once the review says so', () => {
    const assignment = { submissionId: 'recSub1', roundId: 'recRound1', reviewerId: 'recUser1' }
    const rows = reviewerProgress({
      reviewers: [{ id: 'recUser1', name: 'Rae Reviewer', email: 'rae@example.com' }],
      assignments: [assignment],
      reviews: [{ ...assignment, recused: false }],
      roundId: 'recRound1',
    })

    expect(rows[0]).toMatchObject({ reviewed: 1, recused: 0 })
  })
})

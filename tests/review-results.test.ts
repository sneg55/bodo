// The review results report. Every expectation here is a cell an organizer reads, so the
// assertions are on the grid rather than on a helper's return value.
//
// The gap this closes, from the ABS-13 finding: the file the run downloaded had no
// recommendation column, no review status column, and no per-criterion scores. The other
// half of the finding is the reason the dropdown column is asserted by LABEL: exporting the
// stored score would put `1` in a column headed Recommendation.

import { describe, expect, it } from 'vitest'

import { reviewResultsTable, reviewStatusText } from '@/features/review/review-results'

// The rubric and the row builders moved to a helper when the column tests split out of this
// file, so both suites describe the same round.
import { input, review } from './helpers/review-results-fixtures'

describe('reviewStatusText', () => {
  it('separates nobody was asked from asked and not answered', () => {
    // Different actions for the organizer: one is their own missed assignment step, the
    // other is a reviewer to chase.
    expect(reviewStatusText({ reviewRequired: true, assigned: 0, filed: 0 })).toBe('Not assigned')
    expect(reviewStatusText({ reviewRequired: true, assigned: 2, filed: 0 })).toBe('Not started')
  })

  it('reports partial and full completion', () => {
    expect(reviewStatusText({ reviewRequired: true, assigned: 2, filed: 1 })).toBe('In review')
    expect(reviewStatusText({ reviewRequired: true, assigned: 2, filed: 2 })).toBe('Complete')
  })

  it('is Not required for a row that was never meant to go through review', () => {
    expect(reviewStatusText({ reviewRequired: false, assigned: 2, filed: 0 })).toBe('Not required')
  })

  it('counts an unassigned review as complete rather than as never assigned', () => {
    // An admin who scored a row out of curiosity with no assignment row behind it. Saying
    // "Not assigned" beside a filed review would read as a bug.
    expect(reviewStatusText({ reviewRequired: true, assigned: 0, filed: 1 })).toBe('Complete')
  })
})

describe('reviewResultsTable', () => {
  it('exports a dropdown answer as its LABEL, never as the score it stores', () => {
    const [, row] = reviewResultsTable(
      input({
        reviews: [review({ id: 'rev1', reviewerId: 'user1', scores: { rec: 1 } })],
      }),
    )

    // The whole point of ABS-13's read-back half: `1` under a column headed
    // Recommendation is worse than no column at all.
    expect(row.at(10)).toBe('Accept')
  })

  it('lists who was ASKED, not only who answered', () => {
    // The row that made this wrong: `Not started` beside an empty reviewer column, which
    // reads as nobody having been asked and contradicts the status two columns to the left.
    const [, row] = reviewResultsTable(
      input({
        assignments: [
          { submissionId: 'sub1', reviewerId: 'user2' },
          { submissionId: 'sub1', reviewerId: 'user1' },
          // The same person assigned twice is two rows and one reviewer.
          { submissionId: 'sub1', reviewerId: 'user1' },
        ],
      }),
    )

    expect(row.at(3)).toBe('Not started')
    expect(row.at(4)).toBe('Ana Ruiz | Bo Chen')
    expect(row.at(5)).toBe('')
  })

  it('keeps every multi-value cell in the same reviewer order, gaps included', () => {
    const rows = reviewResultsTable(
      input({
        assignments: [
          { submissionId: 'sub1', reviewerId: 'user1' },
          { submissionId: 'sub1', reviewerId: 'user2' },
        ],
        reviews: [
          // Filed second, sorts first: Bo scored Originality and nothing else.
          review({
            id: 'rev2',
            reviewerId: 'user2',
            scores: { originality: 2 },
            recommendation: 'no',
          }),
          review({
            id: 'rev1',
            reviewerId: 'user1',
            scores: { originality: 4, rec: 1 },
            notes: { comments: 'Strong opener' },
            recommendation: 'yes',
          }),
        ],
      }),
    )
    const row = rows.at(1)

    expect(row?.at(5)).toBe('Ana Ruiz | Bo Chen')
    expect(row?.at(6)).toBe('2')
    expect(row?.at(8)).toBe('Yes | No')
    expect(row?.at(9)).toBe('4/5 | 2/5')
    // Bo skipped the dropdown and the comment. The position is still HELD, because
    // collapsing it would shift Ana's answer onto Bo. Empty rather than a dash: a lone `-`
    // is a value a spreadsheet evaluates, so `csvCell` would quote it behind a tab.
    expect(row?.at(10)).toBe('Accept | ')
    expect(row?.at(11)).toBe('Strong opener | ')
  })

  it('reports a recusal as an answer rather than as an outstanding review', () => {
    const [, row] = reviewResultsTable(
      input({
        reviews: [
          review({ id: 'rev1', reviewerId: 'user1', recused: true, comment: 'I work with them' }),
        ],
      }),
    )

    expect(row.at(8)).toBe('Recused')
  })

  it('carries the aggregate the Abstracts table shows, including its two empty states', () => {
    const scored = reviewResultsTable(
      input({
        // originality 4 of 1..5 is 0.75 and is the only COUNTED criterion: `comments` is
        // text, and `rec` is a dropdown, which is recorded and shown but not scored.
        //
        // This expectation was 38%, from `(1 * 0.75 + 1 * 0) / 2`, and that arithmetic was
        // the defect rather than the intent. `rec` is `Accept=1 / Maybe=2 / Reject=3`, so
        // normalising it against the span of its option values scored the reviewer's
        // Accept as zero, the worst answer available, and dragged a strong review from 75%
        // to 38% with nothing on screen saying the scale had inverted. See `CriterionKind`
        // in @/types/review and `countedCriteria` in @/features/review/scoring.
        reviews: [review({ id: 'rev1', reviewerId: 'user1', scores: { originality: 4, rec: 1 } })],
      }),
    )
    expect(scored.at(1)?.at(7)).toBe('75%')

    // Nothing scored yet is an EMPTY field. The table draws that state as `-`, which is
    // right on screen and wrong in a file: it is not a value, and a spreadsheet reads a
    // leading `-` as a formula.
    expect(reviewResultsTable(input()).at(1)?.at(7)).toBe('')
    expect(
      reviewResultsTable(
        input({
          submissions: [
            {
              id: 'sub1',
              code: 'ABS-1',
              title: 'Keynote',
              status: 'accepted',
              reviewRequired: false,
            },
          ],
        }),
      )
        .at(1)
        ?.at(7),
    ).toBe('n/a')
  })

  it('labels an AI review and keeps it out of the score it sits beside', () => {
    const [, row] = reviewResultsTable(
      input({
        reviewerNames: new Map([
          ['user1', 'Ana Ruiz'],
          ['ai', 'AI pre-screen'],
        ]),
        aiReviewerIds: new Set(['ai']),
        reviews: [
          review({ id: 'rev1', reviewerId: 'user1', scores: { originality: 5 } }),
          review({ id: 'rev2', reviewerId: 'ai', scores: { originality: 1 } }),
        ],
      }),
    )

    // BUILD_SPEC 5.4: labelled, and not in the human average. Without the marker the row
    // would read `Reviews 2` beside a Score averaged from one, and nothing would say why.
    expect(row.at(5)).toBe('AI pre-screen (AI) | Ana Ruiz')
    expect(row.at(6)).toBe('2')
    // Ana alone: originality 5 of 1..5 is 1.0. Including the AI's 1 would give 50%.
    expect(row.at(7)).toBe('100%')
  })

  it('does not let a pre-screen finish the committee', () => {
    // A submission assigned to a reviewer who has not opened it, pre-screened by the model:
    // counting the AI's review as filed made the row read `Complete`, which is the one claim
    // the pre-screen is explicitly not allowed to make (BUILD_SPEC 5.4). Seen in a real
    // export of the seeded event.
    const [, row] = reviewResultsTable(
      input({
        assignments: [{ submissionId: 'sub1', reviewerId: 'user1' }],
        reviewerNames: new Map([
          ['user1', 'Ana Ruiz'],
          ['ai', 'AI Pre-screen'],
        ]),
        aiReviewerIds: new Set(['ai']),
        reviews: [review({ id: 'rev1', reviewerId: 'ai', scores: { originality: 3 } })],
      }),
    )

    expect(row.at(3)).toBe('Not started')
    // The review itself is still in the file, still labelled, still counted as a review.
    expect(row.at(5)).toBe('AI Pre-screen (AI)')
    expect(row.at(6)).toBe('1')
  })

  it('drops the criteria columns on a plan with no rounds rather than emitting none', () => {
    const rows = reviewResultsTable(input({ round: undefined }))
    expect(rows.at(0)).toHaveLength(9)
    expect(rows.at(1)).toHaveLength(9)
  })

  it('emits one row per submission whether or not it has been reviewed', () => {
    const rows = reviewResultsTable(
      input({
        submissions: [
          { id: 'sub1', code: 'ABS-1', title: 'One', status: 'submitted', reviewRequired: true },
          { id: 'sub2', code: 'ABS-2', title: 'Two', status: 'submitted', reviewRequired: true },
        ],
        assignments: [{ submissionId: 'sub1', reviewerId: 'user1' }],
        reviews: [review({ id: 'rev1', reviewerId: 'user1', scores: { originality: 4 } })],
      }),
    )

    expect(rows).toHaveLength(3)
    expect(rows.at(1)?.at(3)).toBe('Complete')
    expect(rows.at(2)?.at(3)).toBe('Not assigned')
    expect(rows.at(2)?.at(4)).toBe('')
  })
})

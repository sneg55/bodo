// How one cell of the review results report is written.
//
// Split out of review-results.ts, which assembles the grid and was at the file limit once
// the assigned-reviewers column and the header de-duplication landed in it. The seam is the
// one the report actually has: that file decides what the columns ARE, this one decides what
// a value looks like once it is in one.
//
// Pure and total. No clock, no I/O.

import { criterionScoreText } from '@/features/review/criterion-answer'
import { ratingFor, ratingText } from '@/features/review/ratings'
import { recommendationLabel } from '@/features/review/review-draft'
import type { Criterion, Review } from '@/types/domain'

/**
 * ONE separator for every multi-value cell, so position N is always reviewer N.
 *
 * That invariant is the whole readability of the file: `Reviewers who filed` reads
 * `Ana | Bo` and the Originality column beside it reads `4 | 2`, and a reader can line them
 * up by eye. A comma would not survive it, because a free-text criterion's prose is full of
 * commas and nothing would say where one reviewer's answer ended.
 *
 * A reviewer who skipped a criterion still occupies their position, as an EMPTY one:
 * `4 |  | 2` is three reviewers with the middle one silent. Collapsing the gap would shift
 * every later answer onto the wrong person.
 */
const JOIN = ' | '

/**
 * An absent value is an empty field, not a dash.
 *
 * The table's own `-` placeholder (`EMPTY_CELL` in abstracts-rows.ts) is right on screen and
 * wrong here, and this report is where that showed: `csvCell` defuses a value a spreadsheet
 * would evaluate as a formula by prefixing a tab, and a lone `-` is exactly such a value, so
 * every empty cell in the downloaded file came out as a quoted tab-dash. In place of nothing
 * at all, in every blank cell of the report.
 */
export const EMPTY = ''

/** One column's value from its per-reviewer parts, in reviewer order. */
export function cell(parts: readonly string[]): string {
  return parts.length === 0 ? EMPTY : parts.join(JOIN)
}

/**
 * The aggregate, as the Abstracts table's Ratings cell renders it, except for one case.
 *
 * `not_required` keeps its `n/a`, which is a fact about the submission worth stating. A
 * submission with no scores yet does NOT: `ratingText` answers `-` there, and a dash is the
 * table's way of drawing an empty cell rather than a value the report should write down.
 */
export function scoreCell(input: Parameters<typeof ratingFor>[0]): string {
  const rating = ratingFor(input)
  return rating.kind === 'none' ? EMPTY : ratingText(rating)
}

/**
 * The round's own verdict, as the human label.
 *
 * A recusal is reported as such rather than as a blank: it is the reviewer having answered,
 * and a blank here would read as the one thing it is not, an outstanding review.
 */
export function recommendationCell(review: Review): string {
  if (review.recused) return 'Recused'
  const { recommendation } = review
  return recommendation === undefined ? EMPTY : recommendationLabel(recommendation)
}

/**
 * One reviewer's answer to one criterion.
 *
 * A dropdown resolves to its OPTION LABEL. This is the whole reason the report waited on
 * `criterion-answer.ts`: a "Recommendation" criterion answered Accept is stored as the
 * number that option carries, so exporting the stored value would put `1` in the file under
 * a column headed Recommendation, which is worse than omitting the column.
 */
export function answerCell(criterion: Criterion, review: Review): string {
  if (criterion.kind === 'text') {
    const note = new Map(Object.entries(review.notes)).get(criterion.key)
    return note === undefined || note.trim() === '' ? EMPTY : note
  }
  const score = new Map(Object.entries(review.scores)).get(criterion.key)
  return score === undefined ? EMPTY : criterionScoreText(criterion, score)
}

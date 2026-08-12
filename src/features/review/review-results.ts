// The review results report: one row per submission, with every reviewer's answer to
// every criterion, their recommendation, and where the submission stands in review.
//
// WHY THIS IS NOT A COLUMN ON THE ABSTRACTS TABLE. `abstracts-csv.ts` exports the table's
// own visible columns through the same `rowText` accessors the sort and the filter use, so
// a renamed column cannot silently export blank. That rule is right and it is kept. It
// cannot hold per-criterion detail, because criteria are per-round and organizer-authored:
// the column KEY SET changes whenever a rubric is edited, and stored column preferences
// outlive any one surface's column set (the same note in abstracts-csv.ts). A rubric edit
// would leave a saved preference pointing at a criterion that no longer exists, which is
// exactly the blank column that rule exists to prevent.
//
// So this report has its own single source of truth instead of borrowing that one: its
// columns are DERIVED from the round's criteria, in the round's order, so a renamed
// criterion renames its column and a deleted one takes its column with it. The aggregate
// column goes through `ratingFor`/`ratingText`, which is what the Abstracts table's Ratings
// cell renders, so the report and the table cannot disagree about a percentage.
//
// Pure and total. No clock, no I/O: the action in export-actions.ts does the reads.

// What one value looks like once it is in a column lives in review-results-cells.ts, which
// also holds the two rules that shape this file: the positional `JOIN`, and that an absent
// value is an empty field.
import {
  answerCell,
  cell,
  recommendationCell,
  scoreCell,
} from '@/features/review/review-results-cells'
import type { Criterion, RecordId, Review } from '@/types/domain'

/** What a submission's review stands at. Named for a reader, not for the schema. */
export type ReviewStatusText =
  | 'Not required'
  | 'Not assigned'
  | 'Not started'
  | 'In review'
  | 'Complete'

/**
 * Where one submission is in review.
 *
 * `Not assigned` and `Not started` are deliberately different answers, for the reason
 * `reviewer-progress.ts` splits the same pair: nobody was asked is an organizer's own
 * missed step, and asked-but-not-answered is a reviewer to chase. Collapsing them into
 * "0 reviews" is what makes the assignment step invisible until the deadline.
 */
export function reviewStatusText(input: {
  reviewRequired: boolean
  assigned: number
  filed: number
}): ReviewStatusText {
  if (!input.reviewRequired) return 'Not required'
  if (input.assigned === 0) return input.filed === 0 ? 'Not assigned' : 'Complete'
  if (input.filed === 0) return 'Not started'
  return input.filed < input.assigned ? 'In review' : 'Complete'
}

export type ResultsSubmission = {
  readonly id: RecordId
  readonly code: string
  readonly title: string
  readonly status: string
  readonly reviewRequired: boolean
}

export type ReviewResultsInput = {
  readonly submissions: readonly ResultsSubmission[]
  readonly reviews: readonly Review[]
  readonly assignments: readonly { readonly submissionId: string; readonly reviewerId: string }[]
  /** Already resolved to something readable by `reviewerDisplayName`. */
  readonly reviewerNames: ReadonlyMap<RecordId, string>
  /** The round being reported on. Absent means a plan with no rounds: criteria columns go. */
  readonly round: { readonly criteria: readonly Criterion[] } | undefined
  /** Excluded from the aggregate the same way the Abstracts table excludes them. */
  readonly aiReviewerIds?: ReadonlySet<string>
}

/**
 * The fixed columns, before the round's criteria are appended.
 *
 * Two of these names are the way they are because of what the file looked like when they
 * were not:
 *
 *   - **`Assigned reviewers` and `Reviewers who filed` are different columns.** There used to
 *     be one, called `Reviewers`, holding the people who had FILED. So a row the same file
 *     marked `Not started` listed no reviewers at all, which reads as nobody having been
 *     asked: the exact distinction `reviewStatusText` exists to draw, contradicted two
 *     columns later. The filed one keeps the positional invariant `JOIN` describes and
 *     therefore keeps its place next to the criteria; the assigned one is a plain list.
 *   - **`Round recommendation`, not `Recommendation`.** A round's rubric may itself hold a
 *     criterion labelled Recommendation (the seeded one does), and the criteria columns are
 *     appended from those labels, so the header row carried the word twice with two
 *     different meanings. `resultsHeaders` handles the general collision; this makes the
 *     fixed one say which recommendation it is.
 */
const FIXED_HEADERS = [
  'Code',
  'Title',
  'Status',
  'Review status',
  'Assigned reviewers',
  'Reviewers who filed',
  'Reviews',
  'Score',
  'Round recommendation',
] as const

/**
 * The header row: the fixed columns, then one per criterion, with collisions resolved.
 *
 * Criterion labels are organizer-authored, so any of them can equal a fixed header or
 * another criterion's label. Two columns with the same name in a CSV is not an error
 * anywhere: the file opens, the columns are both there, and every reader downstream has to
 * guess which is which. The suffix says which is which instead.
 */
export function resultsHeaders(criteria: readonly Criterion[]): readonly string[] {
  const headers: string[] = [...FIXED_HEADERS]
  for (const criterion of criteria) {
    const taken = new Set(headers)
    if (!taken.has(criterion.label)) {
      headers.push(criterion.label)
      continue
    }
    const qualified = `${criterion.label} (criterion)`
    if (!taken.has(qualified)) {
      headers.push(qualified)
      continue
    }
    // Two criteria with the same label, which the rubric editor allows. Numbered by
    // position, so the column still points at one of them rather than at neither.
    headers.push(`${criterion.label} (criterion ${String(criteria.indexOf(criterion) + 1)})`)
  }
  return headers
}

/**
 * Header row plus one row per submission, ready for `toCsv`.
 *
 * The grid is returned rather than a CSV string so the quoting stays in one place
 * (`abstracts-csv.ts`) and so the shape can be asserted cell by cell in a test.
 */
export function reviewResultsTable(input: ReviewResultsInput): readonly (readonly string[])[] {
  const criteria = input.round?.criteria ?? []
  const bySubmission = groupReviews(input.reviews, input.reviewerNames, input.aiReviewerIds)
  const assignedTo = groupAssignments(input.assignments, input.reviewerNames)

  return [
    resultsHeaders(criteria),
    ...input.submissions.map((submission) => {
      const filed = bySubmission.get(submission.id) ?? []
      const assigned = assignedTo.get(submission.id) ?? []
      return [
        submission.code,
        submission.title,
        submission.status,
        reviewStatusText({
          reviewRequired: submission.reviewRequired,
          assigned: assigned.length,
          // HUMAN reviews only, for the same reason `ratingFor` excludes them from the
          // score. Counted with the AI's, a pre-screened submission that no reviewer had
          // opened read as `Complete`, which is the one thing this column exists to say and
          // the pre-screen is explicitly not (BUILD_SPEC 5.4). The `Reviews` count beside it
          // still counts every review, because that column is about the file's own contents.
          filed: filed.filter((entry) => input.aiReviewerIds?.has(entry.review.reviewerId) !== true)
            .length,
        }),
        cell(assigned),
        cell(filed.map((entry) => entry.name)),
        String(filed.length),
        scoreCell({
          reviewRequired: submission.reviewRequired,
          reviews: filed.map((entry) => entry.review),
          criteria,
          aiReviewerIds: input.aiReviewerIds,
        }),
        cell(filed.map((entry) => recommendationCell(entry.review))),
        ...criteria.map((criterion) =>
          cell(filed.map((entry) => answerCell(criterion, entry.review))),
        ),
      ]
    }),
  ]
}

/**
 * The reviews on each submission, in a STABLE order: by reviewer name, then by id.
 *
 * The AI pre-screen's reviews are KEPT and LABELLED rather than dropped. BUILD_SPEC 5.4
 * requires an AI review to be "clearly labeled, never counted in the human average by
 * default", and `ratingFor` above already handles the second half. Dropping them would
 * hide a pre-screen a chair paid for; keeping them unlabelled would leave `Reviews 2`
 * beside a Score averaged from one, with nothing on the row explaining the difference.
 */
function groupReviews(
  reviews: readonly Review[],
  names: ReadonlyMap<RecordId, string>,
  aiReviewerIds: ReadonlySet<string> | undefined,
): ReadonlyMap<string, readonly { name: string; review: Review }[]> {
  const grouped = new Map<string, { name: string; review: Review }[]>()
  for (const review of reviews) {
    const name = names.get(review.reviewerId) ?? 'Unknown reviewer'
    const entry = {
      name: aiReviewerIds?.has(review.reviewerId) === true ? `${name} (AI)` : name,
      review,
    }
    const bucket = grouped.get(review.submissionId)
    if (bucket === undefined) grouped.set(review.submissionId, [entry])
    else bucket.push(entry)
  }
  for (const bucket of grouped.values()) {
    // Sorted so the positional invariant is reproducible: two exports of unchanged data
    // must put the same reviewer in the same position, and Airtable's row order is not a
    // promise. The id breaks a tie between two people with the same display name.
    bucket.sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.review.id.localeCompare(right.review.id),
    )
  }
  return grouped
}

/**
 * Who was ASKED, per submission, by name and in a stable order.
 *
 * Names rather than a count, which is what this used to be. The count fed `Review status`
 * and nothing else, so a row could say `Not started` beside an empty reviewer column and the
 * file contained no way to find out who had not started. Deduplicated on the reviewer,
 * because a committee assigned twice is two rows and one person.
 */
function groupAssignments(
  assignments: readonly { readonly submissionId: string; readonly reviewerId: string }[],
  names: ReadonlyMap<RecordId, string>,
): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, Set<string>>()
  for (const assignment of assignments) {
    const held = grouped.get(assignment.submissionId) ?? new Set<string>()
    held.add(names.get(assignment.reviewerId) ?? 'Unknown reviewer')
    grouped.set(assignment.submissionId, held)
  }
  // Sorted for the same reason the reviews are: two exports of unchanged data must produce
  // the same file, and Airtable's row order is not a promise.
  return new Map([...grouped].map(([id, held]) => [id, [...held].sort()]))
}

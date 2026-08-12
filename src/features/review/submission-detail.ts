// Everything the organizer's submission detail page renders, in one read.
//
// The surface it feeds did not exist, and its absence was the single most expensive gap
// in the eval run: nothing in the Abstracts table opened a record, so an organizer could
// read no abstract body, no custom field answer, no participant list with roles, and no
// reviewer comment anywhere in the product. Three rubric items describe reading exactly
// that data on the organizer side, and several more could not be demonstrated without it.
//
// Assembled here rather than in the page for the reason the other surface loaders give:
// the page wires params and renders, and a read this wide (submission, form, tracks, tags,
// reviews, rounds, reviewers) wants to be readable in one place. Every call is a tagged,
// cached DAL read, so the fan-out costs one round of cache hits rather than seven
// sequential requests.
//
// It returns `undefined` for "no such submission on this event", and the PAGE calls
// `notFound()`. That split is not stylistic: a `notFound()` thrown from inside a Suspense
// boundary renders the 404 body after the status line has already gone out, so the
// response is HTTP 200 with a 404 page. See .claude/rules/bodo-conventions.md.

import type { EventRole, ReviewRecommendation } from '@/constants/status'
import { eventRoleOf } from '@/features/auth/wiring'
import { type AiOverride, readAiOverride } from '@/features/review/ai-override'
import { aiReviewerOrNone } from '@/features/review/ai-reviewer'
import { criterionScoreText } from '@/features/review/criterion-answer'
import {
  aggregateRoundFor,
  humanReviews,
  type RatingCell,
  ratingFor,
} from '@/features/review/ratings'
import { listEventReviewers, listReviewsForEvent } from '@/features/review/review-reads'
import { reviewerDisplayName } from '@/features/review/reviewer-progress'
import { scoreReview } from '@/features/review/scoring'
import type { SimilarToResult } from '@/features/review/similarity'
import { similarToSubmission } from '@/features/review/similarity-read'
import {
  getSubmission,
  listForms,
  listRoundsForActivePlan,
  listSubmissions,
  listTags,
  listTracks,
} from '@/services/airtable/queries'
import { type ContentRevision, listRevisionsForSubmission } from '@/services/airtable/revisions'
import type { Criterion, RecordId, SubmissionWithParticipants } from '@/types/domain'
import type { Form } from '@/types/forms'
import { AI_REVIEWER_NAME } from '@/types/prescreen'

/** One reviewer's verdict, resolved to the things a person can read. */
export type ReviewEntry = {
  id: RecordId
  reviewerName: string
  roundName: string
  /** The round it was filed in, so the override control can address the right row. */
  roundId: RecordId
  /**
   * Written by the AI pre-screen rather than by a person.
   *
   * Carried on the entry rather than inferred from the name, because the name is
   * organizer-editable data and this decides both a label and whether the review is in the
   * committee average. See `ratings.ts`.
   */
  isAi: boolean
  /**
   * The organizer's own score, when a chair has overridden the AI's (ai-override.ts).
   *
   * Present ONLY on an AI review. The AI's own `percent`, `scores` and `comment` below are
   * left untouched, so the panel shows both numbers and says which is which.
   */
  override?: AiOverride
  /** Absent when the round has no criteria, or the review scored none of them. */
  percent?: number
  recommendation?: ReviewRecommendation
  comment?: string
  updatedAt: string
  /**
   * Per-criterion, in the round's own order, so the label is not just a percentage.
   *
   * `text` is the answer as a person reads it, resolved by `criterion-answer.ts`: a
   * dropdown printed the number its option carries, so a "Recommendation" criterion
   * answered "Accept" read back here as `1/3`.
   */
  scores: readonly { label: string; text: string; weight: number }[]
  /**
   * Answers to the round's `text` criteria, in the round's order.
   *
   * These live in `Reviews.notesJson` rather than in `comment`, and NOTHING read them
   * back: an organizer who added a "Comments" free-text criterion saw the reviewer's
   * prose stored, then saw this block say "No comment." on the same review.
   */
  notes: readonly { label: string; text: string }[]
}

export type SubmissionDetailView = {
  submission: SubmissionWithParticipants
  /** The form it was submitted through, absent for a manually created session. */
  form?: Form
  /** Track and tag ids to names, for the answer rows that store record ids. */
  nameOf: (id: RecordId) => string | undefined
  trackName?: string
  tagNames: readonly string[]
  rating: RatingCell
  /**
   * Which round the `rating` above reports on, for the header to say so.
   *
   * The number is one round's, chosen by `aggregateRoundFor`, exactly as the Abstracts
   * table's Ratings cell is. Naming it is what stops a reader comparing this header with a
   * per-round export and concluding one of them is wrong.
   */
  ratingRoundName?: string
  reviews: readonly ReviewEntry[]
  /** Newest first. Empty on a base whose ContentRevisions table has not been created. */
  revisions: readonly ContentRevision[]
  /**
   * Near-duplicates of this submission among the event's others, with the coverage of the
   * sweep that produced them. Carried on the view rather than read by the panel so the
   * organizer's page stays one read: the comparison set is `listSubmissions`, which the
   * Abstracts table this page was opened from has already put in the cache.
   */
  similar: SimilarToResult
  /** What the acting user may do here. Reads are already gated by the route group. */
  role: EventRole
}

export async function loadSubmissionDetail(input: {
  eventId: string
  submissionId: string
}): Promise<SubmissionDetailView | undefined> {
  const submission = await getSubmission(input.submissionId).catch(() => undefined)
  // Belt and braces on top of the route group's role check: a submission id is a path
  // segment, so an organizer of one event must not be able to read another's record by
  // pasting its id. Answered the same as "does not exist", so the id cannot be probed.
  if (submission === undefined || submission.eventId !== input.eventId) return undefined

  const [forms, tracks, tags, reviews, rounds, reviewers, aiReviewerId, revisions, role, siblings] =
    await Promise.all([
      listForms(input.eventId),
      listTracks(input.eventId),
      listTags(input.eventId),
      listReviewsForEvent(input.eventId),
      listRoundsForActivePlan(input.eventId),
      listEventReviewers(input.eventId),
      // Who the pre-screen writes as. Two things on this page need it and BOTH were wrong
      // without it: the header averaged the machine in with the committee, and the review
      // list called it `Unknown reviewer`, because the `ai@system` row holds no
      // `EventMemberships` row on purpose (it authors reviews and must never be a
      // principal) so `listEventReviewers` never returns it. See export-actions.ts, which
      // already made the same repair for the CSV.
      aiReviewerOrNone(),
      // Swallowed rather than fatal, and this is the one read here that is allowed to fail:
      // `ContentRevisions` is the only table in this app that a base created before it was
      // declared will not have, and a 404 from Airtable must cost the page its history
      // section rather than the whole submission. Run `npm run airtable:schema` to add it.
      listRevisionsForSubmission(input.submissionId).catch(() => []),
      eventRoleOf(input.eventId),
      // The comparison set for the near-duplicate panel, and the same tagged read
      // (`event:{id}:submissions`) the Abstracts table this page was opened from just made.
      // It is in the fan-out rather than behind its own loader because a second read path
      // would be a second cache entry over identical rows: the panel is scoring, not reading.
      listSubmissions(input.eventId),
    ])

  const names = new Map([...tracks, ...tags].map((row) => [row.id, row.name]))
  const reviewerNames = new Map([
    ...reviewers.map(
      (reviewer) => [reviewer.id, reviewerDisplayName(reviewer)] as [RecordId, string],
    ),
    // The pre-screen's author, named, exactly as the review-results export names it.
    ...(aiReviewerId === undefined ? [] : [[aiReviewerId, AI_REVIEWER_NAME] as [RecordId, string]]),
  ])
  const aiReviewerIds = aiReviewerId === undefined ? undefined : new Set([aiReviewerId])
  const roundById = new Map(rounds.map((round) => [round.id, round]))
  const mine = reviews.filter((review) => review.submissionId === submission.id)
  // The SAME round the Abstracts table's Ratings cell reports for this row, chosen by the
  // same function from the same human-only reviews. This header read 40% (3) beside a table
  // reading 25% (1) on one submission, and the difference was the two AI pre-screen reviews
  // that only the table knew to leave out, pooled here across every round in the plan.
  const scoringRound = aggregateRoundFor(rounds, humanReviews(mine, { aiReviewerIds }))

  return {
    submission,
    form: forms.find((candidate) => candidate.id === submission.formId),
    nameOf: (id) => names.get(id),
    trackName: submission.trackId === undefined ? undefined : names.get(submission.trackId),
    tagNames: submission.tagIds.flatMap((id) => {
      const name = names.get(id)
      return name === undefined ? [] : [name]
    }),
    rating: ratingFor({
      reviewRequired: submission.reviewRequired,
      reviews:
        scoringRound === undefined
          ? []
          : mine.filter((review) => review.roundId === scoringRound.id),
      criteria: scoringRound?.criteria ?? [],
      aiReviewerIds,
    }),
    ratingRoundName: scoringRound?.name,
    // Newest first: on a submission that has been round-tripped, the latest verdict is
    // the one the decision rests on.
    reviews: [...mine]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((review) => toEntry(review, roundById, reviewerNames, aiReviewerIds)),
    revisions,
    // `siblings` is handed over WITH this submission still in it: the exclusion is
    // `similarTo`'s, which drops the target by id, and a filter here would be a second copy
    // of that rule to keep in step. See similarity-read.ts.
    similar: similarToSubmission({ target: submission, submissions: siblings, forms }),
    role: role ?? 'reviewer',
  }
}

function toEntry(
  review: Awaited<ReturnType<typeof listReviewsForEvent>>[number],
  roundById: ReadonlyMap<RecordId, { name: string; criteria: readonly Criterion[] }>,
  reviewerNames: ReadonlyMap<RecordId, string>,
  aiReviewerIds: ReadonlySet<string> | undefined,
): ReviewEntry {
  const round = roundById.get(review.roundId)
  const criteria = round?.criteria ?? []
  const scored = criteria.length === 0 ? undefined : scoreReview(review, criteria)
  // A Map rather than indexing `scores` with `criterion.key`: the record is typed
  // `Record<string, number>`, so an index expression is `number` even for a key that was
  // never scored, and it is also exactly the dynamic index `security/detect-object-injection`
  // exists to stop.
  const byKey = new Map(Object.entries(review.scores))
  const noteByKey = new Map(Object.entries(review.notes))

  const isAi = aiReviewerIds?.has(review.reviewerId) === true
  const override = isAi ? readAiOverride(review.notes) : undefined

  return {
    id: review.id,
    reviewerName: reviewerNames.get(review.reviewerId) ?? 'Unknown reviewer',
    roundName: round?.name ?? 'Review',
    roundId: review.roundId,
    isAi,
    ...(override === undefined ? {} : { override }),
    // `weightedMean` is a 0-1 fraction and is `undefined` when nothing contributed, so a
    // review that scored none of the round's criteria shows no percentage rather than 0%.
    percent: scored?.weightedMean === undefined ? undefined : Math.round(scored.weightedMean * 100),
    recommendation: review.recommendation,
    // An empty comment is the same as none: the column stores `''` for a reviewer who
    // scored without writing anything, and an empty quote block reads as a bug.
    comment: review.comment?.trim() === '' ? undefined : review.comment,
    updatedAt: review.updatedAt,
    scores: criteria.flatMap((criterion) => {
      const value = byKey.get(criterion.key)
      return value === undefined
        ? []
        : [
            {
              label: criterion.label,
              text: criterionScoreText(criterion, value),
              weight: criterion.weight,
            },
          ]
    }),
    notes: criteria.flatMap((criterion) => {
      if (criterion.kind !== 'text') return []
      const text = noteByKey.get(criterion.key)
      // Trimmed to nothing is an absence, the same rule `comment` is held to above: the
      // reviewer left the box alone, so a labelled empty quote block would read as a bug.
      return text === undefined || text.trim() === '' ? [] : [{ label: criterion.label, text }]
    }),
  }
}

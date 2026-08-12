// The Evaluation surface's arithmetic: the round tab counts, the reviewer's queue, and who
// a round may draw on.
//
// Split out of evaluation-view.ts, which is the READ (seven cached DAL calls fanned out
// once) and was at the file limit. These are pure and total, take plain rows and return the
// shapes the panel draws, and are therefore the part worth pinning in a test: an eval run
// reported a round tab that went from 0/4 to 2/4 on one saved scorecard, with both queue
// cards ticking at once, and that is a counting bug rather than a rendering one.
//
// The counting rule, stated once because three things depend on it: `Reviews` is unique on
// (submission, round, reviewer), so THAT TUPLE is the unit of work. Two assignment rows for
// one pair are one piece of work, not two.

import { displayNameOf } from '@/features/portal/identity'
import { submissionDescription } from '@/features/review/abstract-text'
import type { QueueItem, RoundSummary } from '@/features/review/evaluation-view-types'
import { draftFromReview } from '@/features/review/review-draft'
import type { RecordId, Review, Round, SubmissionWithParticipants } from '@/types/domain'

/** What the counts need of an assignment row. */
export type QueueAssignment = {
  readonly roundId: string
  readonly submissionId: string
  readonly reviewerId: string
}

/** `submissionId:roundId:reviewerId`, the tuple Reviews is unique on. */
export function reviewKey(review: QueueAssignment): string {
  return `${review.submissionId}:${review.roundId}:${review.reviewerId}`
}

/**
 * Per-round progress across the whole committee.
 *
 * `reviews` is already filtered to the reviews that count: the caller applies
 * `humanReviews`, because per-round progress is a fact about the COMMITTEE and an AI
 * pre-screen must not move it (BUILD_SPEC 5.4). The plan editor counted them and this did
 * not, which is how one round read `4 assigned / 6 reviewed` on one screen and `2/4` on the
 * other.
 */
export function roundSummaries(
  rounds: readonly Round[],
  assignments: readonly QueueAssignment[],
  reviews: readonly Pick<Review, 'submissionId' | 'roundId' | 'reviewerId'>[],
): readonly RoundSummary[] {
  const done = new Set(reviews.map(reviewKey))
  return rounds.map((round) => {
    // DISTINCT (submission, reviewer), not rows: see the note at the top of the file.
    // Counted as rows, a duplicated assignment puts 100% out of reach and makes one save
    // move the counter by two.
    const inRound = new Set(
      assignments
        .filter((assignment) => assignment.roundId === round.id)
        .map((assignment) => reviewKey(assignment)),
    )
    return {
      id: round.id,
      name: round.name,
      order: round.order,
      criteria: round.criteria,
      assigned: inRound.size,
      reviewed: [...inRound].filter((key) => done.has(key)).length,
      anonymous: round.anonymous,
      reviewerIds: round.reviewerIds,
      startsAt: round.startsAt,
      endsAt: round.endsAt,
    }
  })
}

/**
 * Whether a round is one this person may work in.
 *
 * An EMPTY pool means everyone, which is what every round that predates the column
 * holds and what an organizer who has not restricted one means. A named pool excludes
 * everyone else, including an admin: an organizer who wants to review puts themselves
 * in the pool, which leaves a record of the decision, and the alternative is a silent
 * bypass that puts scores in the average from somebody the committee never saw.
 */
export function inPool(round: Round, reviewerId: RecordId): boolean {
  return round.reviewerIds.length === 0 || round.reviewerIds.includes(reviewerId)
}

/** The people a round can draw on: its pool, or the whole event when it has none. */
export function poolFor<T extends { id: RecordId }>(
  round: Round | undefined,
  everyone: readonly T[],
): readonly T[] {
  if (round === undefined || round.reviewerIds.length === 0) return everyone
  return everyone.filter((person) => round.reviewerIds.includes(person.id))
}

/** One reviewer's work in one round, as rows the panel can draw without another read. */
export function buildQueue(input: {
  assignments: readonly QueueAssignment[]
  reviewerId: RecordId
  round: Round | undefined
  submissionById: ReadonlyMap<RecordId, SubmissionWithParticipants>
  reviewByKey: ReadonlyMap<string, Review>
  trackNameById: ReadonlyMap<RecordId, string>
  descriptionFields: ReadonlyMap<string, string>
}): readonly QueueItem[] {
  const { reviewerId, round } = input
  const queue: QueueItem[] = []
  // One card per SUBMISSION, whatever the assignment rows say. A reviewer holds one review
  // per (submission, round), so a second assignment row for a pair is a duplicate of the
  // same work: rendered twice, one save ticks both cards, which reads as the panel having
  // scored something nobody looked at.
  const seen = new Set<string>()

  for (const assignment of input.assignments) {
    if (assignment.reviewerId !== reviewerId || assignment.roundId !== round?.id) continue
    if (seen.has(assignment.submissionId)) continue
    seen.add(assignment.submissionId)
    const submission = input.submissionById.get(assignment.submissionId)
    // An assignment whose submission was deleted is dropped rather than rendered as an
    // empty card the reviewer cannot act on.
    if (submission === undefined) continue

    const review = input.reviewByKey.get(
      reviewKey({ ...assignment, reviewerId, roundId: assignment.roundId }),
    )
    queue.push({
      submissionId: submission.id,
      code: submission.code,
      title: submission.title,
      // The thing being judged. Untruncated: see QueueItem.description.
      description: submissionDescription(submission, input.descriptionFields),
      status: submission.status,
      trackName:
        submission.trackId === undefined ? undefined : input.trackNameById.get(submission.trackId),
      draft: draftFromReview(review),
      reviewed: review !== undefined,
      // Withheld, not hidden. See the note on `QueueItem.authors`.
      authors:
        round.anonymous || submission.participants.length === 0
          ? undefined
          : submission.participants
              .map((participant) => displayNameOf(participant.speaker))
              .join(', '),
    })
  }

  // Unreviewed first, so the queue always opens on work rather than on history.
  return queue.sort((left, right) => Number(left.reviewed) - Number(right.reviewed))
}

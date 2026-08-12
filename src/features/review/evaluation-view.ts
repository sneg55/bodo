// Everything the Evaluation surface renders, assembled server side into one flat,
// serializable object.
//
// The reviewer queue is the join BUILD_SPEC 5.4 describes: submissions in the round
// where a `ReviewAssignments` row exists for the acting reviewer. It is computed from
// two cached lists rather than a lookup per row, which is the fan-out section 3.1 rules
// out, and the result carries only the fields the panel draws. A queue item is not a
// `SubmissionWithParticipants`: shipping every speaker's biography to render a title is
// the payload mistake section 6.3 names.
//
// No auth here. The caller has already established who is asking and what they hold;
// this module would happily assemble a queue for anyone, which is exactly why it is not
// the security boundary (see actions.ts for where that lives).

import type { EventRole, SubmissionStatus } from '@/constants/status'
import { prescreenJobsOrUnavailable, prescreenView } from '@/features/jobs/prescreen-progress'
import { type PrescreenCounts, prescreenCounts } from '@/features/jobs/prescreen-queue'
import { descriptionFieldIds } from '@/features/review/abstract-text'
import { aiReviewerOrNone } from '@/features/review/ai-reviewer'
// The counting and the queue shaping live next door, pure and tested. See
// evaluation-queue.ts for why the unit of work is the (submission, round, reviewer) tuple.
import {
  buildQueue,
  inPool,
  poolFor,
  reviewKey,
  roundSummaries,
} from '@/features/review/evaluation-queue'
import type {
  AssignableSubmission,
  EvaluationView,
  PrescreenView,
  QueueItem,
  RoundSummary,
} from '@/features/review/evaluation-view-types'
import { humanReviews } from '@/features/review/ratings'
import type { ReviewDraftState } from '@/features/review/review-draft'
import {
  type EventReviewer,
  listAssignmentsForEvent,
  listEventReviewers,
  listReviewsForEvent,
  listReviewTeamsWithMembers,
} from '@/features/review/review-reads'
import { type ReviewerProgressRow, reviewerProgress } from '@/features/review/reviewer-progress'
import { AI_SAMPLE_NOTICE, isAiMocked } from '@/services/ai'
import {
  getActivePlan,
  listForms,
  listRoundsForActivePlan,
  listSubmissions,
  listTracks,
} from '@/services/airtable/queries'
import type {
  Criterion,
  EvaluationPlan,
  RecordId,
  Review,
  ReviewTeam,
  Round,
  SubmissionWithParticipants,
} from '@/types/domain'
import type { AiPrescreenJob } from '@/types/prescreen'
import { hasAirtable } from '@/utils/env'

// The rendered shapes live in evaluation-view-types.ts. Re-exported here because every
// consumer already imports them from this module, and the split was about file size, not
// about moving four import sites.
export type {
  AssignableSubmission,
  EvaluationView,
  PrescreenView,
  QueueItem,
  RoundSummary,
} from '@/features/review/evaluation-view-types'

export async function loadEvaluationView(input: {
  eventId: RecordId
  reviewerId: RecordId
  role: EventRole
  /** From the round tab strip. Defaults to the plan's first round. */
  roundId?: RecordId
  /** BUILD_SPEC 5.4's "toggle to include". Off unless an organizer asked for it. */
  includeAi?: boolean
}): Promise<EvaluationView> {
  const { eventId, reviewerId, role } = input
  const isAdmin = role === 'admin'
  const includeAi = input.includeAi ?? false

  const [
    plan,
    rounds,
    submissions,
    tracks,
    forms,
    allReviews,
    assignments,
    teams,
    reviewers,
    aiReviewerId,
    jobs,
  ] = await Promise.all([
    getActivePlan(eventId),
    listRoundsForActivePlan(eventId),
    listSubmissions(eventId),
    listTracks(eventId),
    // For the abstract body only. It is an answer keyed by the form's own field id, so
    // there is no way to read it without knowing which field that is (abstract-text.ts).
    listForms(eventId),
    listReviewsForEvent(eventId),
    listAssignmentsForEvent(eventId),
    // With their membership, so the assignment panel can say that the committee somebody
    // picked has nobody in this round's pool BEFORE they press the button. See
    // `committee-eligibility.ts`.
    isAdmin ? listReviewTeamsWithMembers(eventId) : [],
    isAdmin ? listEventReviewers(eventId) : [],
    // Nothing when the `ai@system` row was never seeded, which is a disabled pre-screen
    // button rather than a surface that will not render. Anything else the read can fail
    // with reaches the page, because `humanReviews` below excludes nobody when it is not
    // told who the AI is, and a silently machine-inflated progress bar is worse than a
    // visible error (ai-reviewer.ts).
    aiReviewerOrNone(),
    // Tolerated where the read above is not, and prescreen-progress.ts holds the argument:
    // this one decides a progress bar, that one decides whether a machine's scores are in a
    // human average. `undefined` here means "could not read", which the panel says out loud
    // rather than drawing as an empty queue.
    isAdmin ? prescreenJobsOrUnavailable(eventId) : [],
  ])

  // Filtered once, here, rather than at each of the two places below that read it. The
  // per-round progress is a fact about the COMMITTEE, so an AI review must not move it,
  // and the reviewer's own queue is keyed on their own id and never sees these rows.
  const reviews = humanReviews(allReviews, {
    aiReviewerIds: aiReviewerId === undefined ? undefined : new Set([aiReviewerId]),
    includeAi,
  })

  // Rounds this person may work in. An admin sees every round because they configure
  // them, and the pool still governs the QUEUE below: an organizer outside a round's
  // pool sees the round and its progress, and no submissions to score in it.
  const visible = rounds.filter((round) => isAdmin || inPool(round, reviewerId))
  const ordered = [...visible].sort((left, right) => left.order - right.order)
  const activeRoundId = ordered.some((round) => round.id === input.roundId)
    ? input.roundId
    : ordered.at(0)?.id
  const activeRound = ordered.find((round) => round.id === activeRoundId)

  const trackNameById = new Map(tracks.map((track) => [track.id, track.name]))
  const submissionById = new Map(submissions.map((submission) => [submission.id, submission]))
  const reviewByKey = new Map(reviews.map((review) => [reviewKey(review), review]))

  const queue = buildQueue({
    assignments,
    reviewerId,
    round: activeRound,
    submissionById,
    reviewByKey,
    trackNameById,
    // The abstract body is a form ANSWER keyed by the form's own field id, so reading it
    // needs the forms. See abstract-text.ts.
    descriptionFields: descriptionFieldIds(forms),
  })

  return {
    plan,
    rounds: roundSummaries(ordered, assignments, reviews),
    activeRoundId,
    queue,
    role,
    // Over the ROUND POOL where there is one, so the list answers "who still owes me
    // work in this round" rather than listing people the round excludes at 0 of 0.
    progress: isAdmin
      ? reviewerProgress({
          reviewers: poolFor(activeRound, reviewers),
          assignments,
          reviews,
          roundId: activeRoundId,
        })
      : [],
    teams,
    // Pared to the ACTIVE ROUND's pool, so the assignment panel cannot offer somebody
    // the round excludes. Without this the pool would be a setting with no consequence:
    // an organizer restricts round two to three people and the panel keeps listing all
    // six, so the restriction is discovered when a reviewer finds work in a round they
    // were scoped out of.
    reviewers: poolFor(activeRound, reviewers),
    includeAi,
    prescreen: isAdmin ? prescreenView({ jobs, activeRoundId, aiReviewerId }) : undefined,
    assignable: isAdmin
      ? submissions
          .filter((submission) => submission.reviewRequired)
          .map((submission) => ({
            id: submission.id,
            code: submission.code,
            title: submission.title,
            trackId: submission.trackId,
            trackName:
              submission.trackId === undefined ? undefined : trackNameById.get(submission.trackId),
          }))
      : [],
  }
}

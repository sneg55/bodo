'use server'

// The Evaluation panel's one AI write: queue a round's submissions for pre-screening.
//
// It enqueues and returns. Scoring happens on the cron tick (`/api/cron/prescreen`),
// because a round is tens of model calls and a Workers request cannot hold open for them.
// What the organizer gets back is a count, and the progress line takes it from there.
//
// **Admin, checked here.** BUILD_SPEC 5.4 makes the pre-screen an organizer's decision,
// and section 4 is explicit that a layout is not a security boundary: a Server Action is
// reachable without this page ever rendering, so the role is asserted in the action
// itself. A reviewer calling it gets AUTH_FORBIDDEN_ROLE.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { enqueuePrescreenRound } from '@/features/jobs/prescreen-enqueue'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { listReviewsForEvent } from '@/features/review/review-reads'
import { isAiMocked } from '@/services/ai'
import { enqueuePrescreenJobs, resetPrescreenJobs } from '@/services/airtable/mutations-prescreen'
// `listAssignmentsForRound` is not on the `queries` barrel, because it is one of the
// uncached write-path reads `reads-review.ts` keeps to itself. Imported directly for the
// same reason `mutations-review.ts` does: going through the barrel would mean adding it to
// the `DataSource` interface and giving it a fixture branch, and a fixture branch here
// would be a queue that pretends to enqueue without a base to write to.
import { listRoundsForActivePlan } from '@/services/airtable/queries'
import { getAiReviewerId, listPrescreenJobsUncached } from '@/services/airtable/reads-prescreen'
import { listAssignmentsForRound } from '@/services/airtable/reads-review'
import type { RecordId } from '@/types/domain'
import { claimOnce, releaseClaim } from '@/utils/cf'

export async function startPrescreenAction(input: {
  eventId: RecordId
  roundId: RecordId
}): Promise<ActionResult<{ queued: number; skipped: number; contended: boolean }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    // The rounds of the ACTIVE plan are the only ones the UI offers, so a round id from
    // anywhere else is stale or forged. Same check `saveReviewAction` makes, and the same
    // reason it is not a 404.
    const rounds = await listRoundsForActivePlan(input.eventId)
    if (!rounds.some((round) => round.id === input.roundId)) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that round is not in the active plan', {
        eventId: input.eventId,
        roundId: input.roundId,
      })
    }

    const result = await enqueuePrescreenRound({
      eventId: input.eventId,
      roundId: input.roundId,
      mocked: isAiMocked(),
      loadAiReviewerId: getAiReviewerId,
      // Uncached, because it is what decides whether a job is created: a cached list here
      // is how one submission ends up queued twice.
      listAssignments: () => listAssignmentsForRound(input.roundId),
      listReviews: () => listReviewsForEvent(input.eventId),
      // Uncached for the same reason, and it is the half of the round claim that can fail
      // quietly: the lease is fixed, and a throttled press can outlive it even now that a
      // finished press hands the round back. A second press that acquires the round after
      // that must decide from the winner's rows, not from a list that predates them, or it
      // recreates every one of them.
      listJobs: () => listPrescreenJobsUncached(input.eventId),
      createJobs: (jobs) =>
        enqueuePrescreenJobs({
          eventId: input.eventId,
          roundId: input.roundId,
          submissionIds: jobs.submissionIds,
          queuedAt: jobs.queuedAt,
        }),
      resetJobs: (jobIds) => resetPrescreenJobs({ eventId: input.eventId, jobIds }),
      claim: claimOnce,
      // Handed back as soon as the rows are written, so the six-minute lease is what a
      // press that never returns costs, not what the organizer's next press waits for.
      release: releaseClaim,
      // Unique per press. `claimOnce` re-grants to the SAME holder so a retry cannot
      // deadlock against its own lease, which makes anything stable actively dangerous
      // here: two admins pressing together would both be granted the round.
      holder: `prescreen-enqueue:${crypto.randomUUID()}`,
      now: () => new Date().toISOString(),
    })

    return actionOk(result)
  } catch (error) {
    return actionFailure(error)
  }
}

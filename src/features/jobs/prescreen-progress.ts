// Reading the pre-screen queue for the Evaluation panel, and what to do when that read
// fails.
//
// Sibling of `features/review/ai-reviewer.ts`, and the tolerance here is the opposite shape
// for a reason worth spelling out, because the two sit two lines apart in the same
// `Promise.all`.
//
// `aiReviewerOrNone` may only swallow the unseeded case, because the id it returns decides
// whether a machine's scores are excluded from a human average: getting it wrong changes a
// number on screen and says nothing. This read decides the pre-screen PROGRESS LINE and
// nothing else. Losing it costs an organizer the "14 of 32 scored" bar, which is a thing
// they can see is missing, and the panel says why.
//
// What made this worth having: on 2026-08-09 this one read failed on the deployed Worker
// and took the whole Evaluation page down with it, because it sits at index 9 of the
// `Promise.all` in `loadEvaluationView` and a rejection there rejects all ten. An optional
// progress bar is not worth a page.
//
// The write path does NOT come through here. `enqueuePrescreen` decides create-vs-skip from
// `listPrescreenJobsUncached`, and a list it could not read must never be read as "no jobs
// exist yet", because that queues a second row for every submission. That path still throws.

import { prescreenCounts, prescreenFailures } from '@/features/jobs/prescreen-queue'
import type { PrescreenView } from '@/features/review/evaluation-view-types'
import { AI_SAMPLE_NOTICE, isAiMocked } from '@/services/ai'
import { listPrescreenJobs } from '@/services/airtable/reads-prescreen'
import type { RecordId } from '@/types/domain'
import type { AiPrescreenJob } from '@/types/prescreen'
import { hasAirtable } from '@/utils/env'

/**
 * The queue for one event, or `undefined` when it could not be read.
 *
 * `undefined` and `[]` are deliberately different values and the caller has to keep them
 * apart: `[]` means the round has no jobs, which renders as no progress bar, and so does
 * `undefined`. If the two collapsed into one the panel would show a round with 32 scored
 * submissions as though nothing had ever run.
 *
 * `load` is injectable so the tolerance can be tested without standing up Airtable; every
 * caller in the app takes the default.
 */
export async function prescreenJobsOrUnavailable(
  eventId: RecordId,
  load: (id: RecordId) => Promise<readonly AiPrescreenJob[]> = listPrescreenJobs,
): Promise<readonly AiPrescreenJob[] | undefined> {
  try {
    return await load(eventId)
  } catch (error) {
    // Loud, because this is a degraded render and the failure is otherwise invisible: the
    // page still returns 200 and the panel only says the progress is unavailable. The
    // message carries the status and Airtable's own error type (services/airtable/failure.ts),
    // which is what makes a recurrence diagnosable from `wrangler tail` alone.
    console.error(`[prescreen] queue unreadable for ${eventId}: ${String(error)}`)
    return undefined
  }
}

/**
 * The pre-screen control's state for ONE round.
 *
 * Scoped to the active round, so "14 of 32" is about the tab the organizer is looking at
 * rather than every round the plan has ever run. Lives here rather than in
 * evaluation-view.ts because the `undefined` case above is the interesting half of it, and
 * because that file is at the size limit.
 */
export function prescreenView(input: {
  /** `undefined` means the queue could not be read, which is NOT an empty queue. */
  jobs?: readonly AiPrescreenJob[]
  activeRoundId?: RecordId
  aiReviewerId?: RecordId
}): PrescreenView {
  // Filtered once: the counts and the failure list have to be about the same rows, or the
  // panel would explain a failure the badge beside it is not counting.
  const inRound = (input.jobs ?? []).filter((job) => job.roundId === input.activeRoundId)
  return {
    // Zeroed when the read failed, which is the only honest arithmetic available on a list
    // nobody has. `queueUnreadable` is what stops the panel drawing those zeros as though
    // they were a fact about the round.
    counts: prescreenCounts(inRound),
    failures: prescreenFailures(inRound),
    sampleNotice: isAiMocked() ? AI_SAMPLE_NOTICE : undefined,
    reviewerId: input.aiReviewerId,
    hasBase: hasAirtable(),
    queueUnreadable: input.jobs === undefined,
  }
}

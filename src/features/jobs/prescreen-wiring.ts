// Where the pre-screen drain meets the AI boundary and the DAL.
//
// The drain takes every boundary as an argument so it stays testable; this is the one
// place those arguments are resolved, for the same reason `reminders-wiring.ts` exists.
// A job wired differently at a second call site would be a second retry policy.

import { drainPrescreenJobs, type PrescreenDrainResult } from '@/features/jobs/prescreen'
import {
  mockPrescreenResult,
  PRESCREEN_MAX_TOKENS,
  PRESCREEN_SYSTEM,
  type PrescreenResult,
  type PrescreenSubmission,
  parsePrescreenResult,
  prescreenQuestion,
  rubricContext,
  rubricJsonSchema,
} from '@/features/jobs/prescreen-rubric'
import { getAiClient, isAiMocked } from '@/services/ai'
import { updatePrescreenJob } from '@/services/airtable/mutations-prescreen'
import { saveReview } from '@/services/airtable/mutations-review'
import {
  getAiReviewerId,
  getPrescreenSubmission,
  getRoundForPrescreen,
  listPrescreenJobsForDrain,
} from '@/services/airtable/reads-prescreen'
import type { Criterion } from '@/types/domain'
import { claimOnce, releaseClaim } from '@/utils/cf'

/**
 * One submission through the model.
 *
 * The response is typed `unknown` rather than `PrescreenResult`, so that the MOCK goes
 * through `parsePrescreenResult` too. That is the property worth having: the keyless path
 * and the live path are then held to the same contract, and a mock that drifted out of
 * shape would fail in a test rather than write a review nothing else can read.
 */
async function scoreSubmission(input: {
  round: { criteria: readonly Criterion[] }
  submission: PrescreenSubmission
}): Promise<PrescreenResult> {
  const { criteria } = input.round
  const raw = await getAiClient().complete<unknown>({
    system: PRESCREEN_SYSTEM,
    // The rubric is the same for every submission in the round, so it carries the cache
    // breakpoint and the abstract sits after it: a round of forty pays for the rubric once.
    context: rubricContext(criteria),
    question: prescreenQuestion(input.submission),
    schema: rubricJsonSchema(criteria),
    maxTokens: PRESCREEN_MAX_TOKENS,
    // A rubric score is a judgement, not a research task, and the budget above covers
    // thinking plus the answer together. `low` keeps a round of forty affordable.
    effort: 'low',
    mock: () => mockPrescreenResult(input.submission, criteria),
  })
  return parsePrescreenResult(raw, criteria)
}

export async function runConfiguredPrescreen(): Promise<PrescreenDrainResult> {
  const aiReviewerId = await getAiReviewerId()

  return await drainPrescreenJobs({
    listJobs: listPrescreenJobsForDrain,
    loadRound: getRoundForPrescreen,
    loadSubmission: getPrescreenSubmission,
    score: scoreSubmission,
    // `'route'`, because this runs in a Route Handler. `saveReview` defaults to `'action'`
    // and both branches of `invalidate` do the same thing today, but passing the truth is
    // what keeps the parameter meaningful the day they differ again.
    saveReview: async (save) => {
      await saveReview(save, 'route')
    },
    updateJob: async (job, patch) => {
      await updatePrescreenJob({ eventId: job.eventId, jobId: job.id, patch }, 'route')
    },
    aiReviewerId,
    claim: claimOnce,
    // Handed back the moment the job's outcome row is written. The lease has to cover a
    // worst-case model call, so without this a job that failed in a second still made its
    // own next attempt wait minutes for a key nobody was using.
    release: releaseClaim,
    // Unique per invocation. `claimOnce` re-grants to the SAME holder on purpose so a
    // retry does not deadlock against its own lease, which makes a stable holder actively
    // dangerous: two overlapping ticks would both be granted the same submission.
    holder: `prescreen:${crypto.randomUUID()}`,
    now: () => new Date().toISOString(),
    // Read here, at the tick that actually scores, rather than passed down from the press:
    // a round can be enqueued under the sample and drained after a key is added, and the
    // row must record what wrote the review it is holding.
    mocked: isAiMocked(),
  })
}

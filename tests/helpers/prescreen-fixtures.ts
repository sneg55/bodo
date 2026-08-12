// The rubric, the abstract and the job row the pre-screen tests are written against.
//
// Shared between the pure tests and the drain tests so the two cannot drift into
// describing different rounds, which is what made the same assertion mean two things in
// the outbox suite before `outbox-drain.ts` was extracted.

import type { PrescreenEnqueueDeps } from '@/features/jobs/prescreen-enqueue'
import type { PrescreenSubmission } from '@/features/jobs/prescreen-rubric'
import type { Criterion } from '@/types/domain'
import type { AiPrescreenJob } from '@/types/prescreen'

/** The seed's Screening rubric, so a test failure reads like a real round. */
export const CRITERIA: readonly Criterion[] = [
  { key: 'relevance', label: 'Relevance', kind: 'numeric', min: 1, max: 5, weight: 2 },
  { key: 'clarity', label: 'Clarity', kind: 'numeric', min: 1, max: 5, weight: 1 },
]

export const SUBMISSION: PrescreenSubmission = {
  id: 'recSub1',
  code: 'SESS-12',
  title: 'Evaluating agents without a golden dataset',
  abstract: 'How to build a rubric when there is nothing to compare against.',
}

/**
 * One press of the button, with every boundary stubbed.
 *
 * Shared for the same reason the fixtures above are: the enqueue's own suite and the
 * lease suite next to it both press the button, and a second copy of this bag is how the
 * two would end up describing different rounds.
 */
export function enqueueDeps(overrides: Partial<PrescreenEnqueueDeps> = {}): PrescreenEnqueueDeps {
  return {
    eventId: 'recEvent1',
    roundId: 'recRound1',
    mocked: false,
    loadAiReviewerId: () => Promise.resolve('recAi'),
    listAssignments: () =>
      Promise.resolve([
        { submissionId: 'recSub1', roundId: 'recRound1' },
        { submissionId: 'recSub2', roundId: 'recRound1' },
      ]),
    listReviews: () => Promise.resolve([]),
    listJobs: () => Promise.resolve([]),
    createJobs: (input) => Promise.resolve({ created: input.submissionIds.length }),
    resetJobs: () => Promise.resolve(),
    claim: () => Promise.resolve({ granted: true }),
    release: () => Promise.resolve({ released: true }),
    holder: 'press-1',
    now: () => '2026-08-09T10:00:00.000Z',
    ...overrides,
  }
}

export function prescreenJob(overrides: Partial<AiPrescreenJob> = {}): AiPrescreenJob {
  return {
    id: 'recJob1',
    eventId: 'recEvent1',
    roundId: 'recRound1',
    submissionId: 'recSub1',
    status: 'queued',
    attempts: 0,
    // False by default, because it is only written when a run FINISHES: a queued row has
    // not been scored by anything yet.
    mocked: false,
    queuedAt: '2026-08-09T10:00:00.000Z',
    ...overrides,
  }
}

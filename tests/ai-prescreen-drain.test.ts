// One cron tick of the AI pre-screen.
//
// Every dependency is an argument, the same shape `tests/accelevents-sync.test.ts` uses
// and for the same reason: the cases worth pinning are interleavings between two ticks
// and a model call that throws, and neither is reachable through the UI.

import { describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { drainPrescreenJobs, type PrescreenDrainDeps } from '@/features/jobs/prescreen'
import { PRESCREEN_LEASE_MS } from '@/features/jobs/prescreen-queue'
import { AI_WORST_CASE_CALL_MS } from '@/services/ai/limits'
import { WORST_CASE_CALL_MS } from '@/services/airtable/scheduler'

import { CRITERIA, prescreenJob, SUBMISSION } from './helpers/prescreen-fixtures'

const SCORED = {
  scores: { relevance: 4, clarity: 3 },
  comment: 'Clear and on topic.',
  recommendation: 'yes',
} as const

function drainDeps(overrides: Partial<PrescreenDrainDeps> = {}): PrescreenDrainDeps {
  return {
    listJobs: () => Promise.resolve([prescreenJob()]),
    loadRound: () => Promise.resolve({ id: 'recRound1', criteria: CRITERIA }),
    loadSubmission: () => Promise.resolve(SUBMISSION),
    score: () => Promise.resolve({ ...SCORED, scores: { ...SCORED.scores } }),
    saveReview: () => Promise.resolve(),
    updateJob: () => Promise.resolve(),
    aiReviewerId: 'recAi',
    claim: () => Promise.resolve({ granted: true }),
    release: () => Promise.resolve({ released: true }),
    holder: 'tick-1',
    now: () => '2026-08-09T10:05:00.000Z',
    mocked: false,
    ...overrides,
  }
}

describe('draining a tick', () => {
  it('claims per submission and round, so two overlapping ticks cannot double-score', async () => {
    const claim = vi.fn().mockResolvedValue({ granted: false })
    const score = vi.fn()

    const result = await drainPrescreenJobs(drainDeps({ claim, score }))

    expect(claim).toHaveBeenCalledWith('prescreen:recRound1:recSub1', 'tick-1', expect.any(Number))
    expect(score).not.toHaveBeenCalled()
    expect(result).toMatchObject({ found: 1, contended: 1, scored: 0, failed: 0 })
  })

  it('writes the review under the AI reviewer and marks the job done', async () => {
    const saveReview = vi.fn().mockResolvedValue(undefined)
    const updateJob = vi.fn().mockResolvedValue(undefined)

    const result = await drainPrescreenJobs(drainDeps({ saveReview, updateJob }))

    expect(saveReview).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'recEvent1',
        submissionId: 'recSub1',
        roundId: 'recRound1',
        reviewerId: 'recAi',
        scores: { relevance: 4, clarity: 3 },
      }),
    )
    // Labelled where it is written, so the label travels with the row rather than living
    // only in whichever panel happens to render it.
    const saved = saveReview.mock.calls.at(0)?.at(0) as { comment: string }
    expect(saved.comment).toContain('AI pre-screen')
    expect(updateJob).toHaveBeenLastCalledWith(
      { id: 'recJob1', eventId: 'recEvent1' },
      { status: 'done', finishedAt: '2026-08-09T10:05:00.000Z', mocked: false },
    )
    expect(result).toMatchObject({ scored: 1, failed: 0 })
  })

  it('records on the row that a sample wrote the review, so a live run can supersede it', async () => {
    // Without this the two are indistinguishable afterwards: flipping `AI_MOCK=0` and
    // pressing the button again skipped every submission the sample had already "scored".
    const updateJob = vi.fn().mockResolvedValue(undefined)

    await drainPrescreenJobs(drainDeps({ updateJob, mocked: true }))

    expect(updateJob).toHaveBeenLastCalledWith(
      { id: 'recJob1', eventId: 'recEvent1' },
      { status: 'done', finishedAt: '2026-08-09T10:05:00.000Z', mocked: true },
    )
  })

  it('records the attempt before the call and the error text after it', async () => {
    const updateJob = vi.fn().mockResolvedValue(undefined)
    const score = vi.fn().mockRejectedValue(new AppError(ErrorIds.LLM_RATE_LIMITED, 'slow down'))

    const result = await drainPrescreenJobs(
      drainDeps({
        updateJob,
        score,
        listJobs: () => Promise.resolve([prescreenJob({ attempts: 1 })]),
      }),
    )

    // The attempt is stamped BEFORE the call, so a Worker cancelled mid-request still
    // burns one and the retry cap cannot be outrun by a job that always dies.
    expect(updateJob).toHaveBeenNthCalledWith(
      1,
      { id: 'recJob1', eventId: 'recEvent1' },
      { status: 'running', attempts: 2, startedAt: '2026-08-09T10:05:00.000Z' },
    )
    const failure = updateJob.mock.calls.at(1)?.at(1) as { status: string; error: string }
    expect(failure.status).toBe('failed')
    expect(failure.error).toContain('slow down')
    expect(result).toMatchObject({ scored: 0, failed: 1 })
  })

  it('keeps going after one job fails, so a single bad row cannot stall the queue', async () => {
    const score = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ ...SCORED, scores: { ...SCORED.scores } })

    const result = await drainPrescreenJobs(
      drainDeps({
        score,
        listJobs: () =>
          Promise.resolve([
            prescreenJob({ id: 'recJobA', submissionId: 'recSubA' }),
            prescreenJob({ id: 'recJobB', submissionId: 'recSubB' }),
          ]),
      }),
    )

    expect(result).toMatchObject({ found: 2, scored: 1, failed: 1 })
  })

  it('holds the claim for the whole lease, not a number of its own', async () => {
    const claim = vi.fn().mockResolvedValue({ granted: true })

    await drainPrescreenJobs(drainDeps({ claim }))

    expect(claim).toHaveBeenCalledWith('prescreen:recRound1:recSub1', 'tick-1', PRESCREEN_LEASE_MS)
  })

  it('reports a bookkeeping failure rather than letting it escape the tick', async () => {
    // The failure path writes one row. A throw there used to take the rest of the tick
    // with it, which is the bug `recordSkip` in accelevents-sync.ts has a comment about.
    const updateJob = vi.fn().mockRejectedValue(new Error('airtable is down'))

    const result = await drainPrescreenJobs(drainDeps({ updateJob }))

    expect(result).toMatchObject({ found: 1, scored: 0, failed: 1 })
  })
})

describe('handing the key back', () => {
  // The lease is sized for a Worker that died mid-call, which is minutes. Almost every job
  // settles in seconds, and without a release each one held its key for the rest of that
  // lease: a model refusal is immediate, so its retry waited fourteen minutes for a key
  // nobody was using, and three attempts took most of an hour. A live run superseding a
  // sampled result waited the same, because the key is per (round, submission) and does
  // not change between attempts.

  it('releases the key when the job is scored', async () => {
    const release = vi.fn().mockResolvedValue({ released: true })

    await drainPrescreenJobs(drainDeps({ release }))

    expect(release).toHaveBeenCalledWith('prescreen:recRound1:recSub1', 'tick-1')
  })

  it('releases the key when the job fails, which is the case that was paying for it', async () => {
    const release = vi.fn().mockResolvedValue({ released: true })
    const score = vi.fn().mockRejectedValue(new AppError(ErrorIds.LLM_REFUSED, 'declined'))

    const result = await drainPrescreenJobs(drainDeps({ release, score }))

    expect(release).toHaveBeenCalledWith('prescreen:recRound1:recSub1', 'tick-1')
    expect(result).toMatchObject({ failed: 1 })
  })

  it('releases after the row is written, never before', async () => {
    // Ordering, not just the call. A key handed back before the outcome write lets the
    // next tick read a row the previous tick has not finished recording: it would find the
    // job still `running` with an attempt to spare and score the same abstract again.
    const order: string[] = []
    const updateJob = vi.fn().mockImplementation((_ref: unknown, patch: { status: string }) => {
      order.push(`write:${patch.status}`)
      return Promise.resolve()
    })
    const release = vi.fn().mockImplementation(() => {
      order.push('release')
      return Promise.resolve({ released: true })
    })

    await drainPrescreenJobs(drainDeps({ updateJob, release }))

    expect(order).toEqual(['write:running', 'write:done', 'release'])
  })

  it('releases after the failure row too, in the same order', async () => {
    const order: string[] = []
    const updateJob = vi.fn().mockImplementation((_ref: unknown, patch: { status: string }) => {
      order.push(`write:${patch.status}`)
      return Promise.resolve()
    })
    const release = vi.fn().mockImplementation(() => {
      order.push('release')
      return Promise.resolve({ released: true })
    })

    await drainPrescreenJobs(
      drainDeps({ updateJob, release, score: () => Promise.reject(new Error('boom')) }),
    )

    expect(order).toEqual(['write:running', 'write:failed', 'release'])
  })

  it('never releases a key another tick holds', async () => {
    // The guard would refuse it anyway, since the holder differs, but a loser that asks to
    // release the winner's key is a bug worth catching here rather than trusting the DO to
    // absorb. This tick did no work: it has nothing to hand back.
    const release = vi.fn()

    await drainPrescreenJobs(
      drainDeps({ release, claim: () => Promise.resolve({ granted: false }) }),
    )

    expect(release).not.toHaveBeenCalled()
  })

  it('carries on when the release itself fails, because the job is already recorded', async () => {
    // `releaseClaim` reports rather than throws for exactly this reason, and the drain does
    // not depend on that promise: a release that rejected must not cost the tick the jobs
    // it has not reached, whose keys are still free.
    const release = vi.fn().mockRejectedValue(new Error('guard unreachable'))

    const result = await drainPrescreenJobs(
      drainDeps({
        release,
        listJobs: () =>
          Promise.resolve([
            prescreenJob({ id: 'recJobA', submissionId: 'recSubA' }),
            prescreenJob({ id: 'recJobB', submissionId: 'recSubB' }),
          ]),
      }),
    )

    expect(result).toMatchObject({ found: 2, scored: 2, failed: 0 })
  })
})

describe('the lease, which is the half of the claim that fails silently', () => {
  // A lease shorter than the work it covers does not error. It expires, the next tick finds
  // the row still `running` with attempts left, `claimOnce` grants the key to the new
  // holder, and the same abstract is scored twice: two model calls, and two `saveReview`
  // writes to the one row that is keyed on (submission, round, reviewer), so the second
  // silently overwrites the first. Nothing in the UI can show that it happened.

  it('outlasts a bounded model call plus every Airtable call runOne makes', () => {
    // The five DAL boundaries `runOne` crosses: the `running` write, the round, the
    // submission, `saveReview`, and the final `done`/`failed` write. Each can be throttled
    // for `WORST_CASE_CALL_MS` on its own, because the scheduler honours a `Retry-After`
    // and retries. Strictly greater, so the constant cannot be trimmed back to the sum.
    expect(PRESCREEN_LEASE_MS).toBeGreaterThan(AI_WORST_CASE_CALL_MS + 5 * WORST_CASE_CALL_MS)
  })

  it('counts saveReview as the two requests it really makes', () => {
    // `saveReview` looks the review up before writing it (mutations-review.ts), so the five
    // boundaries are six Airtable requests, which is the same count `PRESCREEN_BATCH` is
    // sized against.
    expect(PRESCREEN_LEASE_MS).toBeGreaterThanOrEqual(
      AI_WORST_CASE_CALL_MS + 6 * WORST_CASE_CALL_MS,
    )
  })
})

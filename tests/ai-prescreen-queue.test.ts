// The queue's three decisions: what to enqueue, what to run next, and when the progress
// line should keep asking the server.
//
// Split from tests/ai-prescreen.test.ts, which keeps the rubric contract and the mock, and
// from tests/ai-prescreen-panel.test.ts, which keeps the two sentences the panel renders.
// All of them share `helpers/prescreen-fixtures.ts` so they cannot drift into describing
// different rounds.

import { describe, expect, it } from 'vitest'

import {
  eligiblePrescreenJobs,
  PRESCREEN_MAX_ATTEMPTS,
  prescreenCounts,
  prescreenOutstanding,
  prescreenTargets,
} from '@/features/jobs/prescreen-queue'
import type { AiPrescreenJob } from '@/types/prescreen'

import { prescreenJob } from './helpers/prescreen-fixtures'

describe('choosing what to enqueue', () => {
  const assignments = [
    { submissionId: 'recSub1', roundId: 'recRound1' },
    { submissionId: 'recSub2', roundId: 'recRound1' },
    { submissionId: 'recSub3', roundId: 'recRound1' },
    { submissionId: 'recSub9', roundId: 'recRound2' },
  ]

  it('excludes submissions that already carry an AI review for the round', () => {
    const targets = prescreenTargets({
      roundId: 'recRound1',
      aiReviewerId: 'recAi',
      mocked: false,
      assignments,
      reviews: [
        { submissionId: 'recSub1', roundId: 'recRound1', reviewerId: 'recAi' },
        // A human review is not a reason to skip: the pre-screen is a second opinion.
        { submissionId: 'recSub2', roundId: 'recRound1', reviewerId: 'recHuman' },
        // The same AI reviewer in another round says nothing about this one.
        { submissionId: 'recSub3', roundId: 'recRound2', reviewerId: 'recAi' },
      ],
      jobs: [],
    })

    expect(targets).toEqual({ create: ['recSub2', 'recSub3'], reset: [] })
  })

  it('needs an assignment, and never queues one submission twice', () => {
    const targets = prescreenTargets({
      roundId: 'recRound1',
      aiReviewerId: 'recAi',
      mocked: false,
      // Two reviewers on one submission is two assignment rows and exactly one job.
      assignments: [...assignments, { submissionId: 'recSub2', roundId: 'recRound1' }],
      reviews: [],
      jobs: [prescreenJob({ submissionId: 'recSub3' })],
    })

    // recSub9 is assigned in another round, so it is not this round's work.
    expect(targets).toEqual({ create: ['recSub1', 'recSub2'], reset: [] })
  })
})

describe('a round pre-screened with the mock, then a key', () => {
  // The judge's path: demo under the default `AI_MOCK=1`, add ANTHROPIC_API_KEY, press the
  // button again. Before the `mocked` column a sample review and its done job were
  // indistinguishable from a live pair, so the live run skipped every submission forever.
  const assignments = [{ submissionId: 'recSub1', roundId: 'recRound1' }]
  const reviews = [{ submissionId: 'recSub1', roundId: 'recRound1', reviewerId: 'recAi' }]
  const sample = prescreenJob({ id: 'recJobSample', status: 'done', attempts: 1, mocked: true })
  const live = prescreenJob({ id: 'recJobLive', status: 'done', attempts: 1 })

  function targetsFor(input: { mocked: boolean; jobs: readonly AiPrescreenJob[] }) {
    return prescreenTargets({
      roundId: 'recRound1',
      aiReviewerId: 'recAi',
      mocked: input.mocked,
      assignments,
      reviews,
      jobs: input.jobs,
    })
  }

  it('re-runs a sampled submission on a live run, in place rather than as a second row', () => {
    // RESET, not duplicated: the progress line counts rows, so a second row for one abstract
    // is the "33 of 32" the enqueue skip exists to prevent.
    expect(targetsFor({ mocked: false, jobs: [sample] })).toEqual({
      create: [],
      reset: ['recJobSample'],
    })
  })

  it('never lets a sample supersede a live result', () => {
    expect(targetsFor({ mocked: true, jobs: [live] })).toEqual({ create: [], reset: [] })
    expect(targetsFor({ mocked: true, jobs: [sample] })).toEqual({ create: [], reset: [] })
    expect(targetsFor({ mocked: false, jobs: [live] })).toEqual({ create: [], reset: [] })
  })

  it('leaves a sampled row alone while another row for the same submission is unfinished', () => {
    // A queued row carries no verdict yet and the live tick will score it, so resetting the
    // sample beside it would put one abstract through the model twice.
    expect(
      targetsFor({ mocked: false, jobs: [sample, prescreenJob({ id: 'recJobPending' })] }),
    ).toEqual({ create: [], reset: [] })
  })

  it('requeues ONE row when the base holds two sampled rows for the same submission', () => {
    // Airtable has no uniqueness constraint, so two rows for one abstract are a state the
    // base can be in. Resetting both sends one submission through the model twice on the
    // next tick: two model calls, and the second review overwrites the first.
    const twin = prescreenJob({
      id: 'recJobTwin',
      status: 'done',
      attempts: 1,
      mocked: true,
      queuedAt: '2026-08-09T11:00:00.000Z',
    })

    // The older row is the canonical one, so the choice does not depend on the order
    // Airtable happened to list them in.
    expect(targetsFor({ mocked: false, jobs: [twin, sample] })).toEqual({
      create: [],
      reset: ['recJobSample'],
    })
    expect(targetsFor({ mocked: false, jobs: [sample, twin] })).toEqual({
      create: [],
      reset: ['recJobSample'],
    })
  })
})

describe('choosing what to run next', () => {
  it('stops retrying a job that has reached the attempt cap', () => {
    const eligible = eligiblePrescreenJobs([
      prescreenJob({ id: 'recSpent', status: 'failed', attempts: PRESCREEN_MAX_ATTEMPTS }),
      prescreenJob({ id: 'recRetry', status: 'failed', attempts: PRESCREEN_MAX_ATTEMPTS - 1 }),
    ])

    expect(eligible.map((entry) => entry.id)).toEqual(['recRetry'])
  })

  it('leaves finished jobs alone and takes the oldest first, up to the batch size', () => {
    const eligible = eligiblePrescreenJobs(
      [
        prescreenJob({ id: 'recDone', status: 'done' }),
        prescreenJob({ id: 'recNewer', queuedAt: '2026-08-09T12:00:00.000Z' }),
        prescreenJob({ id: 'recOlder', queuedAt: '2026-08-09T08:00:00.000Z' }),
      ],
      1,
    )

    expect(eligible.map((entry) => entry.id)).toEqual(['recOlder'])
  })

  it('retries a job left running by an isolate that died', () => {
    // `running` is eligible on purpose. The claim guard, not the status column, is what
    // stops two live ticks colliding, so excluding it here would wedge the queue on any
    // job whose Worker was cancelled between the two writes.
    const eligible = eligiblePrescreenJobs([
      prescreenJob({ id: 'recStuck', status: 'running', attempts: 1 }),
    ])

    expect(eligible.map((entry) => entry.id)).toEqual(['recStuck'])
  })

  it('counts the queue for the progress line, with blocked jobs called out', () => {
    const counts = prescreenCounts([
      prescreenJob({ id: 'a', status: 'done' }),
      prescreenJob({ id: 'b', status: 'done' }),
      prescreenJob({ id: 'c', status: 'running' }),
      prescreenJob({ id: 'd', status: 'queued' }),
      prescreenJob({ id: 'e', status: 'failed', attempts: 1 }),
      prescreenJob({ id: 'f', status: 'failed', attempts: PRESCREEN_MAX_ATTEMPTS }),
    ])

    // Disjoint buckets that add up to the total, because the panel renders one badge per
    // bucket and a row counted twice is a row the organizer is told about twice.
    expect(counts).toEqual({ total: 6, done: 2, running: 1, queued: 1, failed: 1, blocked: 1 })
  })

  it('counts a job cancelled after its last attempt as blocked, not as still running', () => {
    // A Worker can disappear between the attempt stamp and the outcome write, which leaves
    // the row `running` at the cap. Nothing will attempt it again, so calling it running
    // told the organizer it was waiting for something that was never going to happen.
    const stranded = prescreenJob({
      id: 'recStranded',
      status: 'running',
      attempts: PRESCREEN_MAX_ATTEMPTS,
    })

    expect(eligiblePrescreenJobs([stranded])).toEqual([])
    expect(prescreenCounts([stranded])).toEqual({
      total: 1,
      done: 0,
      running: 0,
      queued: 0,
      failed: 0,
      blocked: 1,
    })
  })
})

describe('when the progress line should keep asking the server', () => {
  // Tag invalidation makes the NEXT request fresh; nothing starts one. The panel polls
  // while this is true and stops when it is false, so a drained queue costs nothing.
  it('is outstanding while anything is queued, running, or still retryable', () => {
    expect(prescreenOutstanding(prescreenCounts([prescreenJob({ status: 'queued' })]))).toBe(true)
    expect(prescreenOutstanding(prescreenCounts([prescreenJob({ status: 'running' })]))).toBe(true)
    expect(
      prescreenOutstanding(prescreenCounts([prescreenJob({ status: 'failed', attempts: 1 })])),
    ).toBe(true)
  })

  it('is settled once every job is done or has given up', () => {
    expect(
      prescreenOutstanding(
        prescreenCounts([
          prescreenJob({ id: 'a', status: 'done' }),
          prescreenJob({ id: 'b', status: 'failed', attempts: PRESCREEN_MAX_ATTEMPTS }),
        ]),
      ),
    ).toBe(false)
  })

  it('is settled when there is no queue at all, so an idle round never polls', () => {
    expect(prescreenOutstanding(prescreenCounts([]))).toBe(false)
  })

  it('stops for a capped job whatever status it was left in, or it never stops at all', () => {
    // The stop condition and the drain's eligibility have to be each other's complement.
    // A row stamped with its last attempt and never finished is one no tick will take
    // again, so a poller that waits for it waits forever.
    for (const status of ['queued', 'running', 'failed'] as const) {
      expect(
        prescreenOutstanding(
          prescreenCounts([prescreenJob({ status, attempts: PRESCREEN_MAX_ATTEMPTS })]),
        ),
        `a ${status} job at the attempt cap is settled`,
      ).toBe(false)
    }
  })
})

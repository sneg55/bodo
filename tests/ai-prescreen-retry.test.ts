// A round whose jobs all stopped, and how an organizer gets out of it.
//
// The case is not hypothetical: on the seeded event, both jobs in Initial Review ended
// `2 stopped after 3 attempts` with `0 scored`, because the structured-output schema carried
// `minimum`/`maximum` on a number property and the model API answered 400 to every call.
// The schema is fixed (tests/ai-prescreen.test.ts holds that contract). What these cover is
// the state it left behind: every row was a skip "in any status", so the next press queued
// nothing and told the organizer the round was already covered, and the panel never said
// what had gone wrong.
//
// Split from tests/ai-prescreen-queue.test.ts, which owns the enqueue rules that were
// already right, and sharing its fixtures so the two cannot drift into describing different
// rounds.

import { describe, expect, it } from 'vitest'

import { prescreenStoppedNotice } from '@/features/jobs/prescreen-copy'
import {
  PRESCREEN_MAX_ATTEMPTS,
  prescreenCounts,
  prescreenFailures,
  prescreenOutstanding,
  prescreenTargets,
} from '@/features/jobs/prescreen-queue'

import { prescreenJob } from './helpers/prescreen-fixtures'

const assignments = [
  { submissionId: 'recSub1', roundId: 'recRound1' },
  { submissionId: 'recSub2', roundId: 'recRound1' },
]

function targetsFor(input: { mocked?: boolean; jobs: readonly ReturnType<typeof prescreenJob>[] }) {
  return prescreenTargets({
    roundId: 'recRound1',
    aiReviewerId: 'recAi',
    mocked: input.mocked ?? false,
    assignments,
    reviews: [],
    jobs: input.jobs,
  })
}

/** A job that has run out of attempts: the row a press has to be able to move. */
function stoppedJob(overrides: Parameters<typeof prescreenJob>[0] = {}) {
  return prescreenJob({
    status: 'failed',
    attempts: PRESCREEN_MAX_ATTEMPTS,
    error: 'E_AI_CALL_FAILED: 400 schema is invalid',
    ...overrides,
  })
}

describe('pressing the button again on a round that stopped', () => {
  it('requeues the stopped rows in place rather than reporting the round covered', () => {
    const targets = targetsFor({
      jobs: [
        stoppedJob({ id: 'recJobA', submissionId: 'recSub1' }),
        stoppedJob({ id: 'recJobB', submissionId: 'recSub2' }),
      ],
    })

    // RESET, not create: the progress line counts rows, so a second row per abstract is the
    // "33 of 32" the enqueue skip exists to prevent.
    expect(targets).toEqual({ create: [], reset: ['recJobA', 'recJobB'] })
  })

  it('retries a row stranded `running` at the cap, not only a `failed` one', () => {
    // A Worker cancelled between the attempt stamp and the outcome write leaves the row
    // running at the cap. No tick will take it again, so if a press could not move it either
    // the submission would never be scored by anything.
    const stranded = stoppedJob({
      id: 'recStranded',
      submissionId: 'recSub1',
      status: 'running',
      error: undefined,
    })

    expect(targetsFor({ jobs: [stranded] }).reset).toEqual(['recStranded'])
  })

  it('retries under the keyless sample too', () => {
    // `mocked` decides whether a live run may supersede a sample RESULT. A sample run that
    // ran out of attempts produced no result to protect.
    expect(targetsFor({ mocked: true, jobs: [stoppedJob({ id: 'recJobA' })] }).reset).toEqual([
      'recJobA',
    ])
  })

  it('leaves a submission alone while any row for it is still moving or already done', () => {
    const stopped = stoppedJob({ id: 'recJobA' })
    const queued = prescreenJob({ id: 'recJobQueued' })
    const done = prescreenJob({ id: 'recJobDone', status: 'done', attempts: 1 })

    // A queued twin will be attempted by the next tick, so requeueing beside it would score
    // the abstract twice; a done twin means the AI review already exists.
    expect(targetsFor({ jobs: [stopped, queued] }).reset).toEqual([])
    expect(targetsFor({ jobs: [stopped, done] }).reset).toEqual([])
  })

  it('requeues ONE row when the base holds two stopped rows for the same submission', () => {
    // Airtable has no uniqueness constraint. Resetting both is two model calls on the next
    // tick, with the second review overwriting the first.
    const older = stoppedJob({ id: 'recOlder', queuedAt: '2026-08-09T08:00:00.000Z' })
    const newer = stoppedJob({ id: 'recNewer', queuedAt: '2026-08-09T12:00:00.000Z' })

    expect(targetsFor({ jobs: [newer, older] }).reset).toEqual(['recOlder'])
    expect(targetsFor({ jobs: [older, newer] }).reset).toEqual(['recOlder'])
  })
})

describe('telling the organizer why it stopped', () => {
  it('groups the reasons, most common first, and counts them', () => {
    const failures = prescreenFailures([
      stoppedJob({ id: 'a', error: 'E_AI_CALL_FAILED: 400 schema is invalid' }),
      stoppedJob({ id: 'b', error: 'E_AI_CALL_FAILED: 400 schema is invalid' }),
      stoppedJob({ id: 'c', error: 'E_AI_CALL_FAILED: 429 rate limited' }),
      // Still moving, so its failure is not the organizer's problem yet.
      prescreenJob({ id: 'd', status: 'failed', attempts: 1, error: 'transient' }),
      prescreenJob({ id: 'e', status: 'done', attempts: 1 }),
    ])

    expect(failures).toEqual([
      { error: 'E_AI_CALL_FAILED: 400 schema is invalid', count: 2 },
      { error: 'E_AI_CALL_FAILED: 429 rate limited', count: 1 },
    ])
  })

  it('accounts for a stopped row that never wrote a reason', () => {
    // The cancelled isolate: it is the one failure that reports nothing, and dropping it
    // would leave a badge saying two jobs stopped over a list explaining one.
    const failures = prescreenFailures([
      stoppedJob({ id: 'a', error: undefined }),
      stoppedJob({ id: 'b', error: '   ' }),
    ])

    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ count: 2 })
  })

  it('caps the list rather than reprinting the log', () => {
    const jobs = ['one', 'two', 'three', 'four'].map((error, index) =>
      stoppedJob({ id: `rec${String(index)}`, error }),
    )

    expect(prescreenFailures(jobs)).toHaveLength(3)
    expect(prescreenFailures(jobs, 1)).toHaveLength(1)
  })

  it('says the press is the retry, and says nothing when nothing stopped', () => {
    const counts = prescreenCounts([stoppedJob({ id: 'a' }), stoppedJob({ id: 'b' })])
    const notice = prescreenStoppedNotice(counts)

    expect(notice).toContain('2 submissions stopped')
    expect(notice).toContain('Press AI pre-screen')
    // Settled, so the poller stops: the retry is a press, not a wait.
    expect(prescreenOutstanding(counts)).toBe(false)
    expect(prescreenStoppedNotice(prescreenCounts([]))).toBeUndefined()
  })

  it('reads as one submission when exactly one stopped', () => {
    const notice = prescreenStoppedNotice(prescreenCounts([stoppedJob({ id: 'a' })]))

    expect(notice).toContain('1 submission stopped')
    expect(notice).toContain('was never scored')
  })
})

// Pressing `AI pre-screen`, with every boundary as an argument.
//
// The case worth pinning is two admins pressing the button at the same moment. Airtable has
// no uniqueness constraint, so both requests read the same empty job list and both write:
// the duplicate row runs later, pays for a second model call, overwrites the review, and
// makes the progress line read "33 of 32". None of that is reachable through the UI, which
// is why the enqueue takes a dependency bag exactly as `drainPrescreenJobs` does.
//
// The second group covers the enqueue's other write: the row a supersede resets, whose
// whole point is which keys it sends rather than omits. How long the press HOLDS the round,
// and when it hands it back, lives in tests/ai-prescreen-enqueue-lease.test.ts.

import { describe, expect, it, vi } from 'vitest'

import { enqueuePrescreenRound } from '@/features/jobs/prescreen-enqueue'
import { mapPrescreenJob } from '@/services/airtable/reads-prescreen'
import {
  prescreenJobPatchFields,
  prescreenJobResetFields,
} from '@/services/airtable/to-fields-prescreen'

import { enqueueDeps, prescreenJob } from './helpers/prescreen-fixtures'

describe('enqueueing a round', () => {
  it('creates one job per uncovered submission and counts the rest as skipped', async () => {
    const createJobs = vi.fn().mockResolvedValue({ created: 1 })

    const result = await enqueuePrescreenRound(
      enqueueDeps({
        createJobs,
        listJobs: () => Promise.resolve([prescreenJob({ submissionId: 'recSub2' })]),
      }),
    )

    expect(createJobs).toHaveBeenCalledWith({
      submissionIds: ['recSub1'],
      queuedAt: '2026-08-09T10:00:00.000Z',
    })
    expect(result).toEqual({ queued: 1, skipped: 1, contended: false })
  })

  it('serializes on the round, so two admins pressing together write one set of rows', async () => {
    // The drain's lease is per (round, submission) and only stops simultaneous SCORING; a
    // duplicate row created here runs later and is a second model call nobody asked for.
    const claim = vi.fn().mockResolvedValue({ granted: false })
    const createJobs = vi.fn()
    const listJobs = vi.fn()

    const result = await enqueuePrescreenRound(enqueueDeps({ claim, createJobs, listJobs }))

    expect(claim).toHaveBeenCalledWith('prescreen:enqueue:recRound1', 'press-1', expect.any(Number))
    expect(createJobs).not.toHaveBeenCalled()
    // Not even read: the whole read-decide-write has to sit inside the claim, or the loser
    // decides from a list the winner has already changed.
    expect(listJobs).not.toHaveBeenCalled()
    // A normal outcome rather than an error. The other press is doing this round.
    expect(result).toEqual({ queued: 0, skipped: 0, contended: true })
  })

  it('resets a sampled row in place when a live run supersedes it', async () => {
    const createJobs = vi.fn().mockResolvedValue({ created: 0 })
    const resetJobs = vi.fn().mockResolvedValue(undefined)

    const result = await enqueuePrescreenRound(
      enqueueDeps({
        createJobs,
        resetJobs,
        listAssignments: () => Promise.resolve([{ submissionId: 'recSub1', roundId: 'recRound1' }]),
        listReviews: () =>
          Promise.resolve([{ submissionId: 'recSub1', roundId: 'recRound1', reviewerId: 'recAi' }]),
        listJobs: () =>
          Promise.resolve([prescreenJob({ status: 'done', attempts: 1, mocked: true })]),
      }),
    )

    expect(resetJobs).toHaveBeenCalledWith(['recJob1'])
    expect(createJobs).not.toHaveBeenCalled()
    // Reported as queued, because that is what the organizer sees happen: the row goes back
    // to the head of the queue and the progress line drops by one.
    expect(result).toEqual({ queued: 1, skipped: 0, contended: false })
  })

  it('writes nothing at all when the round is already covered', async () => {
    const createJobs = vi.fn()
    const resetJobs = vi.fn()

    const result = await enqueuePrescreenRound(
      enqueueDeps({
        createJobs,
        resetJobs,
        listJobs: () =>
          Promise.resolve([
            prescreenJob({ id: 'recJobA', submissionId: 'recSub1' }),
            prescreenJob({ id: 'recJobB', submissionId: 'recSub2' }),
          ]),
      }),
    )

    expect(createJobs).not.toHaveBeenCalled()
    expect(resetJobs).not.toHaveBeenCalled()
    expect(result).toEqual({ queued: 0, skipped: 2, contended: false })
  })
})

describe('the row a supersede writes', () => {
  it('clears the sample run rather than leaving its instants on the row', () => {
    // `null` and not an omitted key: the patch builder drops `undefined`, so omitting these
    // would date the live result to the sample it replaced and leave its error text behind.
    expect(prescreenJobResetFields()).toEqual({
      status: 'queued',
      attempts: 0,
      mocked: false,
      error: null,
      startedAt: null,
      finishedAt: null,
    })
  })

  it('round-trips `mocked` through the write and the read, in both directions', () => {
    // False has to survive `compact`, which drops `undefined`: if it were dropped, a live
    // re-run would leave the sample's tick on the row and could never be superseded back.
    expect(prescreenJobPatchFields({ status: 'done', mocked: false })).toMatchObject({
      mocked: false,
    })
    expect(prescreenJobPatchFields({ status: 'done', mocked: true })).toMatchObject({
      mocked: true,
    })

    const fields = {
      event: ['recEvent1'],
      round: ['recRound1'],
      submission: ['recSub1'],
      status: 'done',
      attempts: 1,
    }
    expect(mapPrescreenJob({ id: 'recJob1', fields: { ...fields, mocked: true } }).mocked).toBe(
      true,
    )
    // Airtable omits an unticked checkbox entirely, and the only thing that can mean is
    // that no sample wrote this row.
    expect(mapPrescreenJob({ id: 'recJob1', fields }).mocked).toBe(false)
  })
})

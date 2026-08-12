// The tolerance around the pre-screen queue read, and the distinction it exists to keep:
// a round with no jobs and a round whose jobs could not be read are not the same thing.
//
// This is the 2026-08-09 failure. `listPrescreenJobs` sits at index 9 of the `Promise.all`
// in `loadEvaluationView`, it threw `AiPrescreenJobs: read rejected` on the deployed Worker,
// and a rejection at index 9 rejects all ten: the entire Evaluation page went down for a
// progress bar. (It also ended the request while sibling reads were still parked in the
// rate window, which is the separate bug in rate-window.ts.)

import { describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { prescreenJobsOrUnavailable, prescreenView } from '@/features/jobs/prescreen-progress'
import type { AiPrescreenJob } from '@/types/prescreen'

import { prescreenJob } from './helpers/prescreen-fixtures'

const ROUND = 'recRound1'

function jobsIn(round: string): readonly AiPrescreenJob[] {
  return [
    prescreenJob({ id: 'a', status: 'done', roundId: round }),
    prescreenJob({ id: 'b', status: 'queued', roundId: round }),
  ]
}

describe('reading the pre-screen queue for the panel', () => {
  it('hands back the jobs when the read works', async () => {
    const jobs = jobsIn(ROUND)

    await expect(prescreenJobsOrUnavailable('recEvent', () => Promise.resolve(jobs))).resolves.toBe(
      jobs,
    )
  })

  it('answers undefined rather than throwing, so the page survives the read', async () => {
    // The exact error the deployed Worker raised.
    const failing = () =>
      Promise.reject(new AppError(ErrorIds.NET_BAD_SHAPE, 'AiPrescreenJobs: read rejected (403)'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(prescreenJobsOrUnavailable('recEvent', failing)).resolves.toBeUndefined()

    // Degraded renders that say nothing are how a broken read survives to production, and
    // this one returns HTTP 200 with a panel that looks merely idle.
    expect(logged).toHaveBeenCalledOnce()
    expect(String(logged.mock.calls[0]?.[0])).toContain('read rejected')
    logged.mockRestore()
  })

  it('swallows nothing else: a rejection is the only thing it converts', async () => {
    // Guards against the tolerance being widened into a catch-all later. It converts a
    // rejection into `undefined`; it must never convert a resolved empty list into one,
    // because an empty list is a real answer.
    await expect(
      prescreenJobsOrUnavailable('recEvent', () => Promise.resolve([])),
    ).resolves.toEqual([])
  })
})

describe('the panel state built from that read', () => {
  it('counts the active round when the queue was read', () => {
    const view = prescreenView({ jobs: jobsIn(ROUND), activeRoundId: ROUND })

    expect(view.counts.total).toBe(2)
    expect(view.queueUnreadable).toBe(false)
  })

  it('marks the queue unreadable rather than reporting an empty round', () => {
    // The whole point. Both of these produce all-zero counts and no progress bar, so
    // without the flag a round with 32 scored submissions renders identically to one that
    // has never run, and the organizer is told a comfortable lie.
    const unread = prescreenView({ jobs: undefined, activeRoundId: ROUND })
    const empty = prescreenView({ jobs: [], activeRoundId: ROUND })

    expect(unread.counts).toEqual(empty.counts)
    expect(unread.queueUnreadable).toBe(true)
    expect(empty.queueUnreadable).toBe(false)
  })
})

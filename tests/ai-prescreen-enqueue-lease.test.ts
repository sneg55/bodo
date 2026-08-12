// How long one press of `AI pre-screen` holds the round, and when it hands it back.
//
// Split out of tests/ai-prescreen-enqueue.test.ts, which covers what the press decides and
// writes. This file covers the claim's lifetime, which is the half that fails quietly: a
// lease too short lets two presses interleave and duplicate a round, and a lease held after
// the writes are done tells an organizer who assigns more reviewers and presses again that
// the round is already being queued, which stopped being true minutes ago.

import { readFile } from 'node:fs/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  enqueuePrescreenRound,
  PRESCREEN_ENQUEUE_LEASE_MS,
} from '@/features/jobs/prescreen-enqueue'
import { WORST_CASE_CALL_MS } from '@/services/airtable/scheduler'

import { enqueueDeps, prescreenJob } from './helpers/prescreen-fixtures'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

/**
 * The pre-screen reads with credentials configured and `fetch` captured.
 *
 * Credentials matter: with none the DAL serves fixtures and never issues a request, so a
 * test that skipped this would assert nothing. Same shape as `loadReads` in
 * tests/airtable-read-cache.test.ts, kept local because that file is already at the size
 * limit and this assertion belongs beside the decision it protects.
 */
async function withCapturedFetch(
  body: (context: {
    calls: readonly RequestInit[]
    reads: typeof import('@/services/airtable/reads-prescreen')
  }) => Promise<void>,
): Promise<void> {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()

  const calls: RequestInit[] = []
  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
    calls.push(init ?? {})
    return Promise.resolve(
      new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  await body({ calls, reads: await import('@/services/airtable/reads-prescreen') })
}

describe('handing the round back', () => {
  it('releases the round once its rows are written', async () => {
    // The lease is six minutes, sized for an enqueue throttled the whole way. An organizer
    // who assigns more reviewers and presses again inside it was told the round was
    // already being queued, which stopped being true the moment the writes landed.
    const order: string[] = []
    const release = vi.fn().mockImplementation(() => {
      order.push('release')
      return Promise.resolve({ released: true })
    })

    await enqueuePrescreenRound(
      enqueueDeps({
        release,
        createJobs: (input) => {
          order.push('createJobs')
          return Promise.resolve({ created: input.submissionIds.length })
        },
      }),
    )

    expect(release).toHaveBeenCalledWith('prescreen:enqueue:recRound1', 'press-1')
    expect(order).toEqual(['createJobs', 'release'])
  })

  it('releases after the reset write as well as the create', async () => {
    const order: string[] = []

    await enqueuePrescreenRound(
      enqueueDeps({
        listAssignments: () => Promise.resolve([{ submissionId: 'recSub1', roundId: 'recRound1' }]),
        listJobs: () =>
          Promise.resolve([prescreenJob({ status: 'done', attempts: 1, mocked: true })]),
        resetJobs: () => {
          order.push('resetJobs')
          return Promise.resolve()
        },
        release: () => {
          order.push('release')
          return Promise.resolve({ released: true })
        },
      }),
    )

    expect(order).toEqual(['resetJobs', 'release'])
  })

  it('releases nothing when another press holds the round', async () => {
    const release = vi.fn()

    await enqueuePrescreenRound(
      enqueueDeps({ release, claim: () => Promise.resolve({ granted: false }) }),
    )

    expect(release).not.toHaveBeenCalled()
  })

  it('keeps the lease when a write throws, because the press may still be in flight', async () => {
    // Deliberately not a `finally`. A create that rejected can still have landed, and a
    // second press deciding create-vs-skip while that is in the air is the interleaving the
    // claim exists to stop. Holding the round until the lease expires is the conservative
    // direction, and it is where this stood before the release existed.
    const release = vi.fn()

    await expect(
      enqueuePrescreenRound(
        enqueueDeps({ release, createJobs: () => Promise.reject(new Error('airtable is down')) }),
      ),
    ).rejects.toThrow('airtable is down')
    expect(release).not.toHaveBeenCalled()
  })
})

describe('the lease, which is the half of the claim that can fail quietly', () => {
  it('outlasts an enqueue whose Airtable calls are throttled the whole way', () => {
    // Sized against the retry policy rather than the happy path: the scheduler honours a
    // `Retry-After` and retries, so a throttled enqueue can run for minutes while a lease
    // cut to the happy path has already expired underneath it.
    expect(PRESCREEN_ENQUEUE_LEASE_MS).toBeGreaterThanOrEqual(WORST_CASE_CALL_MS * 3)
  })

  it('reads the jobs it decides from uncached, so a late second holder sees the winner', () => {
    // The half the release does not close. A second press that acquires the round after the
    // lease has lapsed would otherwise decide create-vs-skip from a cached list that
    // predates the winner's rows, and re-create every one of them.
    return withCapturedFetch(async ({ calls, reads }) => {
      await reads.listPrescreenJobsUncached('recEvent1')

      expect(calls.at(0)?.cache).toBe('no-store')
      expect(calls.at(0)?.next).toBeUndefined()
    })
  })

  it('is what the Server Action actually wires the decision to', async () => {
    // Asserted against the source because the action cannot be imported here: `'use server'`
    // pulls the whole auth and DAL wiring in. The uncached read existing changes nothing on
    // its own; being the one the enqueue decides from is the fix.
    const source = await readFile('src/features/review/prescreen-actions.ts', 'utf8')

    expect(source).toContain('listJobs: () => listPrescreenJobsUncached(input.eventId)')
  })

  it('is released by the Server Action as well as claimed by it', async () => {
    // Same reason as above: the release only shortens anything if the action passes it.
    const source = await readFile('src/features/review/prescreen-actions.ts', 'utf8')

    expect(source).toContain('release: releaseClaim')
  })
})

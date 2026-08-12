// `enterSubmissionsIntoRound`, which had no test at all until the duplicate
// implementation in `src/features/review/round-entry.ts` was deleted in favour of it.
//
// It is worth its own file because its correctness rests entirely on a read-then-write
// that Airtable cannot make atomic. Section 3 declares (submission, round) unique, but
// that constraint lives in a base that does not exist yet, and `performUpsert` merges on
// a linked record's primary field TEXT, so it would match the wrong row the moment two
// submissions shared a title. So idempotency is enforced by reading first, and these
// tests pin the three things that makes fragile: the read must not be cached, it must be
// scoped to the round, and the write must expire every tag a screen reads this row from.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const revalidateTag = vi.hoisted(() => vi.fn())

vi.mock('next/cache', () => ({ revalidateTag }))

type Call = { url: string; init: RequestInit }

const ORIGINAL_ENV = { ...process.env }

/** One SubmissionRounds row as Airtable returns it, linked to `round` and `submission`. */
function row(id: string, submissionId: string, roundId: string) {
  return {
    id,
    fields: { submission: [submissionId], round: [roundId], status: 'pending', enteredAt: 'T0' },
  }
}

/**
 * Load the mutation with credentials configured and `fetch` captured.
 *
 * Credentials matter: with none, `getSource()` serves fixtures and never issues a
 * request, so every assertion below would pass against nothing.
 */
async function load(existing: readonly ReturnType<typeof row>[]) {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()

  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} })
    // A create echoes its rows back; every read is the existing-rows list.
    const body =
      (init?.method ?? 'GET') === 'POST' && !url.includes('listRecords')
        ? { records: [row('recNew', 'recSub1', 'recRound2')] }
        : { records: existing }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  return { calls, mutations: await import('@/services/airtable/mutations-review') }
}

beforeEach(() => {
  revalidateTag.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('enterSubmissionsIntoRound', () => {
  it('does nothing at all for an empty cohort, without touching Airtable', async () => {
    const { calls, mutations } = await load([])

    const result = await mutations.enterSubmissionsIntoRound({
      eventId: 'recE1',
      roundId: 'recRound1',
      submissionIds: [],
      enteredAt: 'T1',
    })

    expect(result).toEqual({ created: 0, skipped: 0 })
    expect(calls).toHaveLength(0)
  })

  it('skips a submission already in the round rather than entering it twice', async () => {
    // The whole reason the function reads first. Re-running an advance is something an
    // organizer does by double-clicking, and a duplicate row makes the round's counts
    // wrong everywhere they are displayed.
    const { calls, mutations } = await load([row('recSR1', 'recSub1', 'recRound1')])

    const result = await mutations.enterSubmissionsIntoRound({
      eventId: 'recE1',
      roundId: 'recRound1',
      submissionIds: ['recSub1'],
      enteredAt: 'T1',
    })

    expect(result).toEqual({ created: 0, skipped: 1 })
    expect(calls.filter((call) => (call.init.method ?? 'GET') === 'POST')).toHaveLength(0)
  })

  it('enters only the submissions that are not in the round yet', async () => {
    const { mutations } = await load([row('recSR1', 'recSub1', 'recRound1')])

    const result = await mutations.enterSubmissionsIntoRound({
      eventId: 'recE1',
      roundId: 'recRound1',
      submissionIds: ['recSub1', 'recSub2'],
      enteredAt: 'T1',
    })

    expect(result).toEqual({ created: 1, skipped: 1 })
  })

  it('scopes the check to the round, so round 1 does not block entry to round 2', async () => {
    // `SubmissionRounds` holds every round for every submission, so a check that
    // ignored `roundId` would refuse to advance anyone past the first round.
    const { mutations } = await load([row('recSR1', 'recSub1', 'recRound1')])

    const result = await mutations.enterSubmissionsIntoRound({
      eventId: 'recE1',
      roundId: 'recRound2',
      submissionIds: ['recSub1'],
      enteredAt: 'T1',
    })

    expect(result).toEqual({ created: 1, skipped: 0 })
  })

  it('reads the existing rows uncached, because a cached list double-enters', async () => {
    const { calls, mutations } = await load([])

    await mutations.enterSubmissionsIntoRound({
      eventId: 'recE1',
      roundId: 'recRound1',
      submissionIds: ['recSub1'],
      enteredAt: 'T1',
    })

    const read = calls.find((call) => (call.init.method ?? 'GET') === 'GET')
    expect(read?.init.cache).toBe('no-store')
    expect(read?.init.next).toBeUndefined()
  })

  it('expires the submission tags as well as the event review tag', async () => {
    // The reason this implementation survived and the feature-directory copy did not:
    // that one named only the event tag, which leaves a submission detail page showing
    // a submission that is not in any round.
    const { mutations } = await load([])

    await mutations.enterSubmissionsIntoRound({
      eventId: 'recE1',
      roundId: 'recRound1',
      submissionIds: ['recSub1', 'recSub2'],
      enteredAt: 'T1',
    })

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('event:recE1:review')
    expect(tags).toContain('submission:recSub1')
    expect(tags).toContain('submission:recSub2')
  })

  it('expires nothing when every submission was already in the round', async () => {
    // No row changed, so invalidating would evict warm entries for no reason.
    const { mutations } = await load([row('recSR1', 'recSub1', 'recRound1')])

    await mutations.enterSubmissionsIntoRound({
      eventId: 'recE1',
      roundId: 'recRound1',
      submissionIds: ['recSub1'],
      enteredAt: 'T1',
    })

    expect(revalidateTag).not.toHaveBeenCalled()
  })
})

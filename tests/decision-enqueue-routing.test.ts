// `enqueueOutbox` must go through the DAL's writer, not around it.
//
// It used to build EmailOutbox's field set itself and upsert directly. That field set
// carried `status: 'queued'` and `attempts: 0`, so writing a key whose row had already
// been SENT reset it to queued and the drain sent the mail a second time. Nothing
// prevented that except the accident that decision keys embed `notifiedAt`, which happens
// to be fresh on every Notify press; a caller whose key is stable across runs, which is
// precisely what a reminder sweep has, would have resent on every sweep.
//
// `unqueuedRows` (tests/airtable-outbox-idempotency.test.ts) covers the filtering itself.
// What is pinned here is the routing, because the filtering protects nothing if this
// caller bypasses it. The assertion is therefore about the REQUESTS that reach Airtable:
// a read of the existing keys, and then no create at all.

import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

type Call = { url: string; method: string; body: string }

/**
 * Load with credentials configured and `fetch` captured.
 *
 * Credentials matter: with none, `getSource()` serves fixtures and no request is issued,
 * so every assertion below would hold against nothing at all.
 */
async function load(existingKeys: readonly string[]) {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()
  vi.doMock('next/cache', () => ({ revalidateTag: vi.fn() }))

  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    // The client always sends a JSON string body, so this is a narrowing rather than a
    // stringification: anything else would be a bug worth seeing as an empty body.
    const raw = init?.body
    calls.push({ url, method, body: typeof raw === 'string' ? raw : '' })

    // Every GET here is the existing-keys lookup.
    const body =
      method === 'GET'
        ? {
            records: existingKeys.map((key, index) => ({
              id: `recExisting${String(index)}`,
              fields: { idempotencyKey: key },
            })),
          }
        : { records: [{ id: 'recNew', fields: {} }] }

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  return { calls, module: await import('@/features/submissions/decision-outbox') }
}

const ROWS = [
  {
    eventId: 'recEvt1',
    kind: 'decision.accepted' as const,
    toEmail: 'ada@example.com',
    idempotencyKey: 'accepted:recSub1:T0:recSpk1',
    templateSource: 'system' as const,
    speakerId: 'recSpk1',
    submissionId: 'recSub1',
    sendAt: '2026-08-08T12:00:00.000Z',
    payload: { subject: 'Accepted', html: '<p>hi</p>', attachIcs: false },
  },
]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('next/cache')
  process.env = { ...ORIGINAL_ENV }
})

describe('enqueueOutbox', () => {
  it('writes a key the table has never seen', async () => {
    const { calls, module } = await load([])

    const queued = await module.enqueueOutbox(ROWS)

    expect(queued).toBe(1)
    expect(calls.some((call) => call.method !== 'GET')).toBe(true)
  })

  it('reads the existing keys BEFORE writing anything', async () => {
    // The read is what makes this safe. An upsert on its own cannot tell a new row from
    // a finished one.
    const { calls, module } = await load([])

    await module.enqueueOutbox(ROWS)

    expect(calls.at(0)?.method).toBe('GET')
  })

  it('does not resurrect a row whose key already exists', async () => {
    // The regression. That row may already be `sent`, and re-writing the create field
    // set over it would put it back in the queue and congratulate the speaker twice.
    const { calls, module } = await load(['accepted:recSub1:T0:recSpk1'])

    const queued = await module.enqueueOutbox(ROWS)

    expect(queued).toBe(0)
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([])
  })

  it('still merges on idempotencyKey, so a race cannot duplicate', async () => {
    // The second protection, and the reason the read alone is not enough: between the
    // read and the write a second Notify click can create the same key. The upsert
    // collapses that. `idempotencyKey` is safe to merge on where the Reviews table's
    // keys are not, because it is a real text column rather than a link.
    //
    // An earlier version of this test asserted the write carries no `status` or
    // `attempts`. That was wrong: those fields belong on a CREATE and the DAL sets them
    // deliberately. What made the old direct upsert dangerous was writing them over a
    // row that already existed, which the preceding test is what pins.
    const { calls, module } = await load([])

    await module.enqueueOutbox(ROWS)

    const write = calls.find((call) => call.method !== 'GET')
    expect(write?.body).toContain('"fieldsToMergeOn":["idempotencyKey"]')
  })

  it('writes nothing at all for an empty batch', async () => {
    const { calls, module } = await load([])

    expect(await module.enqueueOutbox([])).toBe(0)
    expect(calls).toEqual([])
  })
})

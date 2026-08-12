// `upsertSpeakersBatch`, the speaker CSV import write. Split out of tests/crm-mutations.test.ts
// for the line limit. This is the load-bearing case in the whole task: a CSV import where
// one row is malformed must still write every good row, which is the opposite of how
// Airtable's own batch create/update behaves (one bad record rejects the whole request),
// and a base-wide problem (rate limiting, an auth failure) must abort rather than retry
// every row for nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dedupedBatch } from './helpers/deduped-batch'
import { fakeSpeakersApi } from './helpers/fake-speakers-api'

const revalidateTag = vi.hoisted(() => vi.fn())

vi.mock('next/cache', () => ({ revalidateTag }))

const ORIGINAL_ENV = { ...process.env }

async function load(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()
  vi.stubGlobal('fetch', fetchImpl)
  return { crmImport: await import('@/services/airtable/mutations-crm-import') }
}

function importRow(rowNumber: number, email?: string) {
  return { rowNumber, email: email ?? `s${rowNumber}@example.com`, firstName: `First${rowNumber}` }
}

/**
 * `upsertSpeakersBatch` takes `DedupedSpeakerRows`, a branded type only the dedup step
 * produces, so a caller cannot skip it (features/crm/import/dedup.ts). Every batch below is
 * built by hand and none repeats an email; the helper verifies that rather than taking it on
 * trust, and throws if it ever stops being true.
 */
const batch = dedupedBatch

beforeEach(() => {
  revalidateTag.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('upsertSpeakersBatch', () => {
  it('creates a new speaker and expires the event roster plus the speaker tag', async () => {
    const { crmImport } = await load(fakeSpeakersApi().fetchImpl)

    const outcomes = await crmImport.upsertSpeakersBatch('action', 'recEvt1', batch([importRow(1)]))

    expect(outcomes).toHaveLength(1)
    const [outcome] = outcomes
    expect(outcome).toMatchObject({ rowNumber: 1, status: 'created' })
    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('event:recEvt1:speakers')
    expect(tags).toContain(`speaker:${outcome.status === 'created' ? outcome.speakerId : ''}`)
  })

  it('matches an existing speaker by normalized email and merges the event link', async () => {
    const api = fakeSpeakersApi({
      initial: {
        Speakers: [{ id: 'recSpk1', fields: { email: 's1@example.com', events: ['recEvtOld'] } }],
      },
    })
    const { crmImport } = await load(api.fetchImpl)

    const outcomes = await crmImport.upsertSpeakersBatch(
      'action',
      'recEvt1',
      batch([importRow(1, 'S1@Example.com')]),
    )

    expect(outcomes[0]).toMatchObject({ rowNumber: 1, status: 'updated', speakerId: 'recSpk1' })
    expect(api.rows('Speakers').find((r) => r.id === 'recSpk1')?.fields.events).toEqual([
      'recEvtOld',
      'recEvt1',
    ])
  })

  it('fails a row with no email without touching Airtable, and does not affect other rows', async () => {
    const api = fakeSpeakersApi()
    const { crmImport } = await load(api.fetchImpl)

    const outcomes = await crmImport.upsertSpeakersBatch(
      'action',
      'recEvt1',
      batch([importRow(1, ''), importRow(2)]),
    )

    expect(outcomes.find((o) => o.rowNumber === 1)).toMatchObject({
      status: 'failed',
      reason: 'Missing email',
    })
    expect(outcomes.find((o) => o.rowNumber === 2)).toMatchObject({ status: 'created' })
  })

  it('lands every good row when one row in its chunk is rejected, and never throws', async () => {
    // The core guarantee: Airtable's batch create is atomic per request, so without a
    // fallback a bad row 7 would take rows 1-6 and 8-10 down with it. This pins that a
    // 25-row import with one bad row in the first ten still returns 24 successes.
    const poisonEmail = 'bad@example.com'
    const { crmImport } = await load(fakeSpeakersApi({ poisonEmail }).fetchImpl)

    const rows = Array.from({ length: 25 }, (_, i) => {
      const rowNumber = i + 1
      return importRow(rowNumber, rowNumber === 7 ? poisonEmail : undefined)
    })

    const outcomes = await crmImport.upsertSpeakersBatch('action', 'recEvt1', batch(rows))

    expect(outcomes).toHaveLength(25)
    expect(outcomes.map((o) => o.rowNumber)).toEqual(rows.map((r) => r.rowNumber))

    const row7 = outcomes.find((o) => o.rowNumber === 7)
    expect(row7?.status).toBe('failed')

    const others = outcomes.filter((o) => o.rowNumber !== 7)
    expect(others.every((o) => o.status === 'created')).toBe(true)
  })

  it('does nothing and expires nothing for an empty batch', async () => {
    const { crmImport } = await load(fakeSpeakersApi().fetchImpl)

    expect(await crmImport.upsertSpeakersBatch('action', 'recEvt1', batch([]))).toEqual([])
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it('expires the OTHER event a matched speaker already belongs to, not only this one', async () => {
    // planRow merges this event into whatever events the matched speaker already had, so
    // that speaker's OTHER event roster (tagged eventSpeakersTag(otherEventId)) goes stale
    // too unless its tag is named. `listSpeakersForEvents(['recEvtB'])` reads exactly that
    // tag (reads-crm.ts).
    const api = fakeSpeakersApi({
      initial: {
        Speakers: [{ id: 'recSpk1', fields: { email: 's1@example.com', events: ['recEvtB'] } }],
      },
    })
    const { crmImport } = await load(api.fetchImpl)

    await crmImport.upsertSpeakersBatch(
      'action',
      'recEvtA',
      batch([importRow(1, 's1@example.com')]),
    )

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('event:recEvtA:speakers')
    expect(tags).toContain('event:recEvtB:speakers')
  })

  it('sends chunks 2 and 3 as one request each while chunk 1 degrades to per-row', async () => {
    // Pins the actual design (batch-then-fallback), not just its outward effect: without
    // this a fallback that always writes one row at a time would pass the row-isolation
    // test above just as well.
    const poisonEmail = 'bad@example.com'
    const api = fakeSpeakersApi({ poisonEmail })
    const { crmImport } = await load(api.fetchImpl)

    const rows = Array.from({ length: 25 }, (_, i) => {
      const rowNumber = i + 1
      return importRow(rowNumber, rowNumber === 7 ? poisonEmail : undefined)
    })
    await crmImport.upsertSpeakersBatch('action', 'recEvt1', batch(rows))

    const speakerWrites = api.writeLog.filter((entry) => entry.table === 'Speakers')
    // Chunk 1 (rows 1-10): one failed 10-record attempt, then ten single-record retries.
    // Order among the ten retries is not asserted, since they run concurrently.
    expect(
      speakerWrites
        .slice(0, 11)
        .map((w) => w.count)
        .sort((a, b) => a - b),
    ).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 10])
    // Chunks 2 and 3 hit no poisoned row, so each goes out as exactly one request.
    expect(speakerWrites.slice(11).map((w) => w.count)).toEqual([10, 5])
  })

  it('does not retry per row on a short response, but still expires the event roster tag', async () => {
    // A batch create that answers 200 with fewer records than requested is not a row
    // failure to retry: retrying on the CREATE path would re-create every row in the
    // group, since there is no reliable way to tell which returned record maps to which
    // row. Every row is reported failed (no id is knowable), but "no id knowable" is not
    // "nothing written" - Airtable may have committed some of the batch and returned a
    // short list, so the roster tag is still expired even though no speaker id is named.
    const api = fakeSpeakersApi({ truncateCreateResponseBy: 1 })
    const { crmImport } = await load(api.fetchImpl)

    const outcomes = await crmImport.upsertSpeakersBatch(
      'action',
      'recEvt1',
      batch([importRow(1), importRow(2)]),
    )

    expect(outcomes.every((o) => o.status === 'failed')).toBe(true)
    const speakerWrites = api.writeLog.filter((entry) => entry.table === 'Speakers')
    expect(speakerWrites).toHaveLength(1)
    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toEqual(['event:recEvt1:speakers'])
  })

  it("an uncertain UPDATE write expires the matched speaker's other event too", async () => {
    // onUncertainWrite used to take no argument and could only name the import's own
    // event. A matched speaker's plan carries the full merged event set (planRow), the
    // same one a SUCCESSFUL update names in recordResult - a shape-mismatch on the update
    // sub-batch has to expire that whole set too, not just the event this import targets.
    const api = fakeSpeakersApi({
      initial: {
        Speakers: [{ id: 'recSpk1', fields: { email: 's1@example.com', events: ['recEvtB'] } }],
      },
      emptyPatchResponseFor: 'Speakers',
    })
    const { crmImport } = await load(api.fetchImpl)

    const outcomes = await crmImport.upsertSpeakersBatch(
      'action',
      'recEvtA',
      batch([importRow(1, 's1@example.com')]),
    )

    expect(outcomes[0]).toMatchObject({ status: 'failed' })
    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('event:recEvtA:speakers')
    expect(tags).toContain('event:recEvtB:speakers')
  })

  it('aborts on a systemic failure (401) instead of retrying every row in the chunk', async () => {
    // 401 is DATA_WRITE_FAIL with the same error id as a 422, but it means the request
    // itself is not authorized, not that any one row's data was bad. Retrying it per row
    // would fail the same way ten more times for nothing; the real risk this guards
    // against is a rate-limited base, where retrying per row turns ~50 requests into ~550.
    const api = fakeSpeakersApi({ alwaysFailStatus: 401 })
    const { crmImport } = await load(api.fetchImpl)

    const rows = Array.from({ length: 15 }, (_, i) => importRow(i + 1))

    await expect(crmImport.upsertSpeakersBatch('action', 'recEvt1', batch(rows))).rejects.toThrow()

    // One failed batch attempt for chunk 1, and chunk 2 never attempted: no per-row
    // fallback, and no further chunks after the abort.
    const speakerWrites = api.writeLog.filter((entry) => entry.table === 'Speakers')
    expect(speakerWrites).toHaveLength(1)
  })

  it("keeps a successful create's tags when the update in the same chunk aborts systemically", async () => {
    // Two reviewers found this independently: processImportChunk used to collect both
    // writeChunk results into one array before folding either into state, so a throw from
    // the SECOND call (updates) discarded the FIRST call's (creates) already-successful
    // outcomes and touched ids, even though those speakers really were written to Airtable.
    const api = fakeSpeakersApi({
      initial: {
        Speakers: [{ id: 'recSpk1', fields: { email: 'existing@example.com', events: [] } }],
      },
      alwaysFailStatus: 401,
      alwaysFailMethod: 'PATCH',
    })
    const { crmImport } = await load(api.fetchImpl)

    const rows = [importRow(1, 'new@example.com'), importRow(2, 'existing@example.com')]

    await expect(crmImport.upsertSpeakersBatch('action', 'recEvt1', batch(rows))).rejects.toThrow()

    const created = api.rows('Speakers').find((r) => r.fields.email === 'new@example.com')
    expect(created).toBeDefined()

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('event:recEvt1:speakers')
    expect(tags).toContain(`speaker:${created?.id}`)
  })

  it('keeps a row that settled inside the per-row fallback when a sibling rejects systemically', async () => {
    // The same defect one layer deeper: writeChunk's fallback used to run the per-row
    // retries as Promise.all, which rejects as soon as ANY of them rejects, discarding the
    // other retries' already-fulfilled results. Three rows share one chunk: a normal row
    // (settles successfully on its own retry), a poisoned row (settles as a legitimate
    // per-row failure, 422 - row-attributable), and a "systemic poison" row (its own retry
    // takes a 401 - NOT row-attributable, so it rejects). The initial 3-row batch fails
    // because of the 422 row, which is what puts all three into the fallback together.
    const poisonEmail = 'bad@example.com'
    const poisonEmailSystemic = 'systemic@example.com'
    const api = fakeSpeakersApi({ poisonEmail, poisonEmailSystemic })
    const { crmImport } = await load(api.fetchImpl)

    const rows = [importRow(1), importRow(2, poisonEmail), importRow(3, poisonEmailSystemic)]

    await expect(crmImport.upsertSpeakersBatch('action', 'recEvt1', batch(rows))).rejects.toThrow()

    const normal = api.rows('Speakers').find((r) => r.fields.email === rows[0]?.email)
    expect(normal).toBeDefined()

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('event:recEvt1:speakers')
    expect(tags).toContain(`speaker:${normal?.id}`)
  })
})

// `upsertSpeakersBatch` when Airtable answers a write SUCCESSFULLY with a response that
// cannot name what it wrote: a short `records` array on a batch, or an empty one on a single
// fallback row. The record may still have been committed, so "the answer names nothing" is
// not "nothing was written" and the tags that WERE knowable before the request went out have
// to be expired anyway.
//
// Split out of tests/crm-mutations-import.test.ts and tests/crm-mutations-partial-writes.test.ts,
// both already at the line limit. What is here rather than there: the two halves of the
// uncertain answer that stayed unexpired after the earlier round of this fix - the speaker id
// on an uncertain UPDATE (known from `plan.recordId`, unlike a create's), and the fallback
// path's single-row write, which reported an ordinary row failure and expired nothing at all.
//
// Every case pins the negative too, because over-expiring is its own defect: a REJECTED
// request wrote nothing, and its ids must NOT be named.

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

/** See tests/crm-mutations-import.test.ts: the brand is only reachable through the dedup step. */
const batch = dedupedBatch

const expiredTags = (): unknown[] => revalidateTag.mock.calls.map((call): unknown => call[0])

beforeEach(() => {
  revalidateTag.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('an uncertain batch UPDATE', () => {
  it('expires the matched speaker, whose record id was known before the write', async () => {
    // The roster tags were already expired here; the speaker's own tag was not, and it is
    // the one an admin actually notices. `getSpeakerProfile` reads `speaker:recSpk1`
    // (reads-crm.ts), so /admin/crm/recSpk1 kept serving the pre-import name, bio and
    // company for the whole REVALIDATE window while the directory around it refreshed.
    // Nothing about the id is uncertain: `planRow` matched it by email BEFORE the request,
    // which is the same reason a SUCCESSFUL update can name it.
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

    // Still reported failed: the response confirmed nothing, so the import must not claim
    // the row landed. The tags are expired regardless, which is the whole position.
    expect(outcomes[0]).toMatchObject({ status: 'failed' })
    expect(expiredTags()).toEqual([
      'event:recEvtB:speakers',
      'event:recEvtA:speakers',
      'speaker:recSpk1',
    ])
  })
})

describe('an uncertain single-row FALLBACK write', () => {
  it('expires the row that landed, and invents no speaker id it never received', async () => {
    // The chunk takes a row-attributable rejection (the 422 row) and degrades to per-row
    // writes. The healthy sibling's own write is COMMITTED - `rows('Speakers')` proves the
    // record exists - and answered with an empty `records` array. That used to become an
    // ordinary `RowWriteFailure` reading "Airtable returned no record" and expire nothing,
    // so the CRM directory served a roster missing a speaker Airtable already had.
    const poisonEmail = 'bad@example.com'
    const api = fakeSpeakersApi({ poisonEmail, emptyCreateResponseFor: 'Speakers' })
    const { crmImport } = await load(api.fetchImpl)

    const outcomes = await crmImport.upsertSpeakersBatch(
      'action',
      'recEvt1',
      batch([importRow(1), importRow(2, poisonEmail)]),
    )

    expect(outcomes.every((o) => o.status === 'failed')).toBe(true)
    // One 2-row batch attempt, then one write per row: the fallback really ran, so this is
    // the single-row branch being exercised and not the batch shape-mismatch branch.
    expect(api.writeLog.filter((w) => w.table === 'Speakers').map((w) => w.count)).toEqual([
      2, 1, 1,
    ])
    // The healthy row is in the base even though the response could not name it.
    expect(api.rows('Speakers').map((r) => r.fields.email)).toEqual(['s1@example.com'])

    // Exactly the event tag, and no `speaker:` tag: a CREATE genuinely has no id to name,
    // so the create path stays event-only rather than guessing one.
    expect(expiredTags()).toEqual(['event:recEvt1:speakers'])
  })

  it('names the speaker on the UPDATE path, and never the row Airtable rejected', async () => {
    // Same fallback, but every row is an update, so `plan.recordId` is known for both. Only
    // the row whose write may have LANDED may be named: row 2 took a 422, which means
    // Airtable rejected it and wrote nothing, so expiring `speaker:recSpk2` would be
    // invalidation with no write behind it.
    const poisonEmail = 'bad@example.com'
    const api = fakeSpeakersApi({
      initial: {
        Speakers: [
          { id: 'recSpk1', fields: { email: 's1@example.com', events: ['recEvtB'] } },
          { id: 'recSpk2', fields: { email: poisonEmail, events: [] } },
        ],
      },
      poisonEmail,
      emptyPatchResponseFor: 'Speakers',
    })
    const { crmImport } = await load(api.fetchImpl)

    const outcomes = await crmImport.upsertSpeakersBatch(
      'action',
      'recEvtA',
      batch([importRow(1, 's1@example.com'), importRow(2, poisonEmail)]),
    )

    expect(outcomes.every((o) => o.status === 'failed')).toBe(true)
    const tags = expiredTags()
    expect(tags).toContain('speaker:recSpk1')
    expect(tags).not.toContain('speaker:recSpk2')
    expect(tags).toContain('event:recEvtA:speakers')
    expect(tags).toContain('event:recEvtB:speakers')
  })

  it('expires what may have landed AND still lets a sibling systemic failure abort', async () => {
    // Both properties together, the convention tests/crm-mutations-partial-writes.test.ts
    // sets: a fix that expires the tags by swallowing the error is the wrong fix, because a
    // caller would then be told an import finished that never did. Three rows share the
    // chunk: one whose isolated write commits but answers with no record, one legitimately
    // rejected 422, and one whose retry takes a 401, which is not row-attributable and so
    // aborts the import from inside `Promise.allSettled`.
    const poisonEmail = 'bad@example.com'
    const poisonEmailSystemic = 'systemic@example.com'
    const api = fakeSpeakersApi({
      poisonEmail,
      poisonEmailSystemic,
      emptyCreateResponseFor: 'Speakers',
    })
    const { crmImport } = await load(api.fetchImpl)

    const rows = [importRow(1), importRow(2, poisonEmail), importRow(3, poisonEmailSystemic)]

    await expect(crmImport.upsertSpeakersBatch('action', 'recEvt1', batch(rows))).rejects.toThrow()

    expect(api.rows('Speakers').map((r) => r.fields.email)).toEqual(['s1@example.com'])
    expect(expiredTags()).toEqual(['event:recEvt1:speakers'])
  })
})

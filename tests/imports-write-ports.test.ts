// The import's write adapters, at the wire.
//
// These three are here rather than in the engine tests because what makes them wrong is
// invisible one layer up: the engine asked for the right thing in every case and the
// adapter sent something else. So `fetch` is stubbed and the assertions read the request
// body and the tags, the way tests/airtable-round-entry.test.ts does.
//
// What is pinned, all three found by review and all three shipped twice (the cron route
// and run-wiring.ts each held their own copy of these ports, which is why they are now one
// factory):
//
//   - an update must not carry `answersJson`, because the DAL REPLACES that column and the
//     import has no answers, so a re-import wiped what a speaker had written in the portal;
//   - a cast write is ADDITIVE, per §5.0e's "never deletes";
//   - a mapping write expires `event:{id}:integrations`, or the Integrations page serves
//     its pre-import mapping list until something else happens to expire it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const revalidateTag = vi.hoisted(() => vi.fn())

vi.mock('next/cache', () => ({ revalidateTag }))

type Call = { url: string; method: string; body: Record<string, unknown> }

const ORIGINAL_ENV = { ...process.env }

/** A `SubmissionParticipants` row as Airtable hands it back. */
function participantRow(id: string, submissionId: string, speakerId: string) {
  return { id, fields: { submission: [submissionId], speaker: [speakerId], role: 'speaker' } }
}

/**
 * Load the ports with credentials configured and every request captured.
 *
 * Credentials matter: with none, `getSource()` serves fixtures and issues no request at
 * all, so every assertion below would pass against nothing.
 */
async function load(records: readonly ReturnType<typeof participantRow>[]) {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()

  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    calls.push({ url, method, body })
    return Promise.resolve(
      new Response(JSON.stringify({ records: method === 'GET' ? records : [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  const { importWritePorts } = await import('@/features/imports/write-ports')
  return { calls, ports: importWritePorts('route') }
}

function bodyOf(calls: readonly Call[], method: string, table: string): Record<string, unknown> {
  const call = calls.find((one) => one.method === method && one.url.includes(table))
  return call?.body ?? {}
}

beforeEach(() => {
  revalidateTag.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('the import update adapter', () => {
  it('never sends answersJson, so a portal edit survives the next import', async () => {
    // The defect: both adapters passed `answers: {}` through the DAL's `updateSubmission`,
    // which stringifies and REPLACES the column. A speaker who edited an imported
    // submission lost every answer on the next run of the same import.
    const { calls, ports } = await load([])

    await ports.updateSubmission({
      submissionId: 'recSub1',
      eventId: 'recEvent',
      title: 'Reliable agents',
      format: 'Talk',
      trackId: 'recTrack',
    })

    const sent = bodyOf(calls, 'PATCH', 'Submissions')
    const records = sent.records as { fields: Record<string, unknown> }[]
    expect(records[0]?.fields).toMatchObject({ title: 'Reliable agents', format: 'Talk' })
    expect(records[0]?.fields).not.toHaveProperty('answersJson')
  })
})

describe('the import cast adapter', () => {
  it('writes a row for the speaker a re-import added, and none for the one already there', async () => {
    const { calls, ports } = await load([participantRow('recPart1', 'recSub1', 'recAda')])

    const written = await ports.addParticipants({
      submissionId: 'recSub1',
      eventId: 'recEvent',
      participants: [
        { speakerId: 'recAda', role: 'speaker', isPrimary: true, sortOrder: 0 },
        { speakerId: 'recGrace', role: 'co_speaker', isPrimary: false, sortOrder: 1 },
      ],
    })

    expect(written).toBe(1)
    const sent = bodyOf(calls, 'POST', 'SubmissionParticipants')
    const records = sent.records as { fields: Record<string, unknown> }[]
    expect(records).toHaveLength(1)
    expect(records[0]?.fields).toMatchObject({ speaker: ['recGrace'] })
  })

  it('writes nothing at all when the cast has not changed', async () => {
    const { calls, ports } = await load([participantRow('recPart1', 'recSub1', 'recAda')])

    const written = await ports.addParticipants({
      submissionId: 'recSub1',
      eventId: 'recEvent',
      participants: [{ speakerId: 'recAda', role: 'speaker', isPrimary: true, sortOrder: 0 }],
    })

    expect(written).toBe(0)
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0)
  })

  it('reads the participants table once however many submissions it is asked about', async () => {
    // Per §3.1 the read has no per-submission form, so a phase over hundreds of rows would
    // spend the whole request budget on reads if this were not memoised per invocation.
    const { calls, ports } = await load([participantRow('recPart1', 'recSub1', 'recAda')])
    const cast = [{ speakerId: 'recAda', role: 'speaker' as const, isPrimary: true, sortOrder: 0 }]

    await ports.addParticipants({ submissionId: 'recSub1', eventId: 'recE', participants: cast })
    await ports.addParticipants({ submissionId: 'recSub2', eventId: 'recE', participants: cast })

    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1)
  })
})

describe('the import mapping adapter', () => {
  it('expires the integrations tag it just wrote through', async () => {
    // The defect: `saveMappings` returned without invalidating anything. A run that
    // committed its mappings and was interrupted before its progress write left the
    // Integrations page showing the mapping list from before the import.
    const { ports } = await load([])

    await ports.saveMappings([
      {
        eventId: 'recEvent',
        entityType: 'speaker',
        localId: 'recAda',
        remoteId: 'sessionize:s1',
        requestHash: 'imported',
        syncedAt: '2026-08-09T12:00:00.000Z',
      },
    ])

    expect(revalidateTag).toHaveBeenCalledWith('event:recEvent:integrations', { expire: 0 })
  })
})

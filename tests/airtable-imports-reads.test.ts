// The ImportRuns reads: the sweep's filter, the history ordering, and the remote index.
//
// The other half of tests/airtable-imports.test.ts, split off at the line the code
// already draws: everything here is either a pure function the reads are built from or an
// assertion about what reaches the network.
//
// Two properties are the reason this file exists:
//
//   1. The cached/uncached split. A cached answer to "what has this run already done"
//      makes a resumed run redo a finished phase or skip an unfinished one, so the
//      uncached reads are asserted at the REQUEST, exactly as
//      tests/airtable-read-cache.test.ts does for the outbox. A read that quietly loses
//      its `no-store` still passes every other test in the suite.
//   2. The reverse index is one list read for the whole event, never a lookup per
//      imported row, which is the fan-out §3.1 says will hit the rate cap.

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { IntegrationMapping } from '@/services/accelevents/sync-types'
import { REVALIDATE } from '@/services/airtable/read-cache'
import {
  dueImportRuns,
  findRemoteMapping,
  indexByRemoteId,
  remoteKey,
  runsNewestFirst,
} from '@/services/airtable/reads-imports'
import type { AirtableRecord } from '@/services/airtable/records'
import { EMPTY_IMPORT_MAPPING, type ImportRun } from '@/types/imports'

function record(id: string, fields: Record<string, unknown>): AirtableRecord {
  return { id, fields }
}

const RUN_CORE = { event: ['recEvent1'], source: 'sessionize', sourceRef: 'jl4ktls0' }

function run(partial: Partial<ImportRun>): ImportRun {
  return {
    id: 'recRun',
    eventId: 'recEvent1',
    source: 'sessionize',
    sourceRef: 'jl4ktls0',
    mapping: EMPTY_IMPORT_MAPPING,
    status: 'queued',
    phase: 'metadata',
    counts: {},
    needsEmail: [],
    ...partial,
  }
}

describe('runsNewestFirst', () => {
  it('puts a run that has never started at the top', () => {
    const ordered = runsNewestFirst([
      run({ id: 'old', status: 'done', startedAt: '2026-08-01T00:00:00.000Z' }),
      run({ id: 'queued' }),
      run({ id: 'recent', status: 'done', finishedAt: '2026-08-08T00:00:00.000Z' }),
    ])

    // The only rows without a `startedAt` are queued ones, so they are the newest thing
    // that has happened to this provider and the row the organizer is waiting on. An
    // Airtable `startedAt desc` sort would bury them, because a blank dateTime sorts
    // smallest, which is why the ordering is done in code at all.
    expect(ordered.map((entry) => entry.id)).toEqual(['queued', 'recent', 'old'])
  })
})

describe('dueImportRuns', () => {
  it('picks up a queued run and a run whose lease has lapsed', () => {
    const due = dueImportRuns(
      [
        run({ id: 'queued' }),
        run({ id: 'lapsed', status: 'running', leaseExpiresAt: '2026-08-09T08:59:00.000Z' }),
        run({ id: 'held', status: 'running', leaseExpiresAt: '2026-08-09T09:05:00.000Z' }),
        run({ id: 'leaseless', status: 'running' }),
        run({ id: 'failed', status: 'failed' }),
        run({ id: 'done', status: 'done' }),
      ],
      '2026-08-09T09:00:00.000Z',
    ).map((entry) => entry.id)

    // A phase-at-a-time run is SUPPOSED to be interrupted, so `running` with a lapsed
    // lease is the resume case rather than an anomaly. A missing lease counts as lapsed:
    // the claim writes both columns in one request, and treating it as resumable is the
    // direction that cannot leave an import half-done. A lease still in the future is
    // the mid-flight protection that actually matters.
    expect(due).toEqual(['queued', 'lapsed', 'leaseless'])
    // `failed` stays out, and this is where the outbox analogy stops: ImportRuns has no
    // attempts column, so an automatic retry would have nothing to terminate it.
    expect(due).not.toContain('failed')
  })
})

describe('the remote-to-local index', () => {
  function mapping(partial: Partial<IntegrationMapping>): IntegrationMapping {
    return {
      id: 'recMap',
      eventId: 'recEvent1',
      entityType: 'submission',
      localId: 'recSub1',
      remoteId: 'sessionize:14022',
      requestHash: 'h',
      syncedAt: '2026-08-01T00:00:00.000Z',
      ...partial,
    }
  }

  it('keys on the stored id, namespace and all, and drops other events', () => {
    const index = indexByRemoteId(
      [
        mapping({ id: 'mine' }),
        mapping({ id: 'theirs', eventId: 'recEvent2', remoteId: 'sessionize:99' }),
      ],
      'recEvent1',
    )

    // The prefix IS the namespace: `sessionize:14022` and `sessionboard:14022` are
    // different rows, which is the point of prefixing at all.
    expect([...index.keys()]).toEqual(['sessionize:14022'])
    expect(index.get(remoteKey('sessionize', '14022'))?.id).toBe('mine')
  })

  it('keeps the newest mapping when two rows claim one remote id', () => {
    const index = indexByRemoteId(
      [
        mapping({ id: 'newer', localId: 'recSub2', syncedAt: '2026-08-05T00:00:00.000Z' }),
        mapping({ id: 'older', localId: 'recSub1', syncedAt: '2026-08-01T00:00:00.000Z' }),
      ],
      'recEvent1',
    )

    // Uniqueness is (event, entityType, localId), so two locals CAN point at one remote.
    // The older row belongs to a superseded local record, and resolving to it would have
    // the import update a record the organizer has already replaced. First-wins would
    // make the answer depend on Airtable's page order, which is not an answer at all.
    expect(index.get('sessionize:14022')?.id).toBe('newer')
  })

  it('finds a legacy unprefixed row and refuses a cross-entity collision', () => {
    const index = indexByRemoteId(
      [mapping({ id: 'legacy', remoteId: 'spk_1', entityType: 'speaker' })],
      'recEvent1',
    )

    // Accelevents rows written before the namespace landed carry a bare id, and refusing
    // them would make the round-trip guard miss exactly the rows it exists to catch.
    expect(findRemoteMapping(index, 'accelevents', 'spk_1')?.id).toBe('legacy')
    // The namespace is the SOURCE, not the entity, so within one source a room and a
    // session can carry the same integer. With an entity type named, no cross-type answer.
    expect(findRemoteMapping(index, 'accelevents', 'spk_1', 'speaker')?.id).toBe('legacy')
    expect(findRemoteMapping(index, 'accelevents', 'spk_1', 'room')).toBeUndefined()
    expect(findRemoteMapping(index, 'sessionize', 'nothing')).toBeUndefined()
  })
})

// ── The live reads, through a stubbed global fetch ────────────────────────────

type Call = { url: string; init: RequestInit }

const ORIGINAL_ENV = { ...process.env }

/**
 * Load the reads with credentials configured and `fetch` captured.
 *
 * Credentials matter: with none the DAL serves fixtures and never issues a request, so a
 * test that skipped this would assert nothing at all. Modules are reset per test so the
 * env boundary and the per-base scheduler are both rebuilt.
 */
async function loadReads(rows: readonly AirtableRecord[] = []): Promise<{
  calls: Call[]
  imports: typeof import('@/services/airtable/reads-imports')
}> {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()

  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} })
    const body = url.includes('/ImportRuns/rec')
      ? { id: 'recRun1', fields: { ...RUN_CORE, leaseHolder: 'sweep-1' } }
      : { records: rows }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  return { calls, imports: await import('@/services/airtable/reads-imports') }
}

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('what the import reads from cache, and what it must not', () => {
  it('serves the run history under the Integrations tag', async () => {
    const { imports, calls } = await loadReads()

    await imports.listImportRuns('recEvent1')

    // One tag covers IntegrationMappings, SyncLog and ImportRuns, because the page reads
    // all three and every control on it writes to more than one.
    expect(calls.at(0)?.init.next).toEqual({
      revalidate: REVALIDATE.edited,
      tags: ['event:recEvent1:integrations'],
    })
  })

  it('leaves one run uncached, because the row is the resume point', async () => {
    const { imports, calls } = await loadReads()

    await imports.getImportRun('recRun1')

    // A cached answer here is a resumed run acting on the state the row had a minute ago:
    // redoing a finished phase, or skipping one that never happened.
    expect(calls.at(0)?.init.cache).toBe('no-store')
    expect(calls.at(0)?.init.next).toBeUndefined()
  })

  it('leaves the lease holder uncached', async () => {
    const { imports, calls } = await loadReads()

    expect(await imports.importRunLeaseHolder('recRun1')).toBe('sweep-1')
    // A cached holder fences against a lease the row has since handed on, which is the
    // mistake the read exists to catch.
    expect(calls.at(0)?.init.cache).toBe('no-store')
  })

  it('leaves the sweep queue uncached', async () => {
    const { imports, calls } = await loadReads()

    await imports.listQueuedImportRuns('2026-08-09T09:00:00.000Z')

    // A cached queue hands a second cron invocation runs the first has already claimed.
    expect(calls.at(0)?.init.cache).toBe('no-store')
    expect(calls.at(0)?.init.next).toBeUndefined()
  })

  it('builds the whole index in one request, not one per row', async () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      record(`recMap${index}`, {
        event: ['recEvent1'],
        entityType: 'submission',
        localId: `recSub${index}`,
        remoteId: `sessionize:${index}`,
        requestHash: 'h',
        syncedAt: '2026-08-01T00:00:00.000Z',
      }),
    )
    const { imports, calls } = await loadReads(rows)

    const index = await imports.loadRemoteIndex('recEvent1')

    // The failure this exists to prevent is a lookup per imported row. Uncached too: the
    // run writes mappings as it creates records, so a cached index would answer a later
    // phase with the state before the earlier one and every record would look new.
    expect(calls).toHaveLength(1)
    expect(calls.at(0)?.init.cache).toBe('no-store')
    expect(index.size).toBe(25)
    expect(imports.findRemoteMapping(index, 'sessionize', '7')?.localId).toBe('recSub7')
  })
})

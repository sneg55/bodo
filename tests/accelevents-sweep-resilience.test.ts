// The retry sweep has to survive its own bookkeeping failing.
//
// This is a RETRY job, so abandoning the backlog is the one behaviour it must not have,
// and the failure that produces it is not the remote call (which is handled) but the
// SyncLog write afterwards. Airtable answers 429 under exactly the load a backlog
// creates, so the log write is the likeliest thing to fail and the least obviously
// dangerous.
//
// Before the per-row guard, a throw from `writeLog` escaped the loop and every remaining
// row in the sweep was silently abandoned. The skip path made it worse: it caught its own
// write failure and then retried the same call with the same arguments against the same
// table, so a real outage produced a second throw that nothing handled.

import { describe, expect, it, vi } from 'vitest'

import {
  type AcceleventsSyncDeps,
  retryFailedAcceleventsSyncs,
} from '@/features/jobs/accelevents-sync'
import type { AccelClient } from '@/services/accelevents/client'
import type { FailedSyncRow, IntegrationMapping } from '@/services/accelevents/sync-types'

function sessionRow(localId: string, hash: string): FailedSyncRow {
  return {
    id: `recSync-${localId}`,
    eventId: 'recEvent',
    entityType: 'submission',
    localId,
    action: 'create',
    status: 'failed',
    payloadJson: '{"title":"t"}',
    payload: { title: 't', startTime: 'T0', endTime: 'T1' },
    error: 'temporary outage',
    at: '2026-08-08T12:00:00.000Z',
    requestHash: hash,
  }
}

function mappingFor(row: FailedSyncRow, hash: string): IntegrationMapping {
  return {
    id: `recMap-${row.localId}`,
    eventId: row.eventId,
    entityType: row.entityType,
    localId: row.localId,
    remoteId: `remote-${row.localId}`,
    requestHash: hash,
    syncedAt: '2026-08-08T12:30:00.000Z',
  }
}

/** The created mock is returned alongside the client, so assertions never read it off
 *  the object (which trips `@typescript-eslint/unbound-method`). */
function accelClient(): { value: AccelClient; createSession: ReturnType<typeof vi.fn> } {
  const createSession = vi.fn().mockResolvedValue({ remoteId: 'ses_1', existed: false })
  return {
    value: {
      createSpeaker: vi.fn(),
      updateSpeaker: vi.fn(),
      findSpeakerByEmail: vi.fn(),
      createSession,
      updateSession: vi.fn().mockResolvedValue({ remoteId: 'ses_1', existed: true }),
      createTaxonomy: vi.fn(),
    },
    createSession,
  }
}

function deps(over: Partial<AcceleventsSyncDeps>): AcceleventsSyncDeps {
  return {
    listFailed: vi.fn().mockResolvedValue([]),
    listMappings: vi.fn().mockResolvedValue([]),
    getEventUrl: vi.fn().mockResolvedValue('ai-engineer-sandbox'),
    client: accelClient().value,
    saveMapping: vi.fn().mockResolvedValue(undefined),
    writeLog: vi.fn().mockResolvedValue(undefined),
    now: () => '2026-08-08T13:00:00.000Z',
    claim: vi.fn().mockResolvedValue({ granted: true }),
    holder: 'run-1',
    ...over,
  }
}

describe('a log write that fails on the skip path', () => {
  it('does not abandon the rest of the backlog', async () => {
    // Row one is an already-accepted hash, so it takes the skip path and its log write
    // fails. Row two is an ordinary retry and must still be attempted.
    const skipped = sessionRow('recSubA', 'hash-a')
    const retryable = sessionRow('recSubB', 'hash-b')
    const client = accelClient()
    const writeLog = vi
      .fn()
      .mockRejectedValueOnce(new Error('Airtable 429'))
      .mockResolvedValue(undefined)

    const result = await retryFailedAcceleventsSyncs(
      deps({
        listFailed: vi.fn().mockResolvedValue([skipped, retryable]),
        listMappings: vi.fn().mockResolvedValue([mappingFor(skipped, 'hash-a')]),
        client: client.value,
        writeLog,
      }),
    )

    expect(client.createSession).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ found: 2, succeeded: 1, failed: 1 })
  })

  it('does not retry the same write in its own handler', async () => {
    // One log row means a handler could only repeat the call that just failed. Two
    // attempts for one skip row is the shape of that mistake.
    const skipped = sessionRow('recSubA', 'hash-a')
    const writeLog = vi.fn().mockRejectedValue(new Error('Airtable 429'))

    await retryFailedAcceleventsSyncs(
      deps({
        listFailed: vi.fn().mockResolvedValue([skipped]),
        listMappings: vi.fn().mockResolvedValue([mappingFor(skipped, 'hash-a')]),
        writeLog,
      }),
    )

    expect(writeLog).toHaveBeenCalledTimes(1)
  })
})

describe('a log write that fails after a successful remote call', () => {
  it('counts the row and keeps going rather than throwing out of the sweep', async () => {
    const first = sessionRow('recSubA', 'hash-a')
    const second = sessionRow('recSubB', 'hash-b')
    const client = accelClient()
    // The success log for row one fails; row two's writes succeed.
    const writeLog = vi
      .fn()
      .mockRejectedValueOnce(new Error('Airtable 429'))
      .mockResolvedValue(undefined)

    const result = await retryFailedAcceleventsSyncs(
      deps({
        listFailed: vi.fn().mockResolvedValue([first, second]),
        client: client.value,
        writeLog,
      }),
    )

    // Both rows reached Accelevents, which is what "did not abandon the backlog" means.
    expect(client.createSession).toHaveBeenCalledTimes(2)
    expect(result.found).toBe(2)
    expect(result.succeeded + result.failed).toBe(2)
  })

  it('never throws, so the route always has counts to log', async () => {
    const row = sessionRow('recSubA', 'hash-a')

    await expect(
      retryFailedAcceleventsSyncs(
        deps({
          listFailed: vi.fn().mockResolvedValue([row]),
          writeLog: vi.fn().mockRejectedValue(new Error('Airtable down')),
        }),
      ),
    ).resolves.toMatchObject({ found: 1 })
  })
})

describe('an empty backlog', () => {
  it('is not an error and calls nothing remote', async () => {
    const client = accelClient()

    const result = await retryFailedAcceleventsSyncs(deps({ client: client.value }))

    expect(result).toEqual({
      found: 0,
      retried: 0,
      succeeded: 0,
      skipped: 0,
      failed: 0,
      contended: 0,
    })
    expect(client.createSession).not.toHaveBeenCalled()
  })
})

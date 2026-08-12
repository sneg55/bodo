// The Accelevents sweep claims per entity, because a create retry is not idempotent.
//
// Two overlapping sweeps seeing one failed create with no mapping would both POST. That
// duplicates the remote session, and it also writes two IntegrationMappings for one
// entity, which is the worse half: `indexMappings` throws on a duplicate, so every later
// sweep aborts before doing any work and the integration wedges itself until somebody
// deletes a row by hand.
//
// Airtable cannot express the uniqueness that would prevent it and the Accelevents API
// offers no dedupe key, so the guard is the same Durable Object the outbox drain uses.

import { describe, expect, it, vi } from 'vitest'

import {
  ACCEL_LEASE_MS,
  type AcceleventsSyncDeps,
  retryFailedAcceleventsSyncs,
} from '@/features/jobs/accelevents-sync'
import type { AccelClient } from '@/services/accelevents/client'
import type { FailedSyncRow, IntegrationMapping } from '@/services/accelevents/sync-types'

function row(localId: string, hash: string): FailedSyncRow {
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

function mappingFor(source: FailedSyncRow, hash: string): IntegrationMapping {
  return {
    id: `recMap-${source.localId}`,
    eventId: source.eventId,
    entityType: source.entityType,
    localId: source.localId,
    remoteId: `remote-${source.localId}`,
    requestHash: hash,
    syncedAt: '2026-08-08T12:30:00.000Z',
  }
}

function client(): { value: AccelClient; createSession: ReturnType<typeof vi.fn> } {
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
    client: client().value,
    saveMapping: vi.fn().mockResolvedValue(undefined),
    writeLog: vi.fn().mockResolvedValue(undefined),
    now: () => '2026-08-08T13:00:00.000Z',
    claim: vi.fn().mockResolvedValue({ granted: true }),
    holder: 'run-1',
    ...over,
  }
}

describe('claiming', () => {
  it('does not call Accelevents for a row another sweep holds', async () => {
    const accel = client()
    const saveMapping = vi.fn()
    const result = await retryFailedAcceleventsSyncs(
      deps({
        listFailed: vi.fn().mockResolvedValue([row('recSubA', 'hash-a')]),
        client: accel.value,
        saveMapping,
        claim: vi.fn().mockResolvedValue({ granted: false }),
      }),
    )

    expect(accel.createSession).not.toHaveBeenCalled()
    // No mapping either. Two mappings for one entity is what wedges every later sweep.
    expect(saveMapping).not.toHaveBeenCalled()
    expect(result).toMatchObject({ found: 1, contended: 1, retried: 0, failed: 0 })
  })

  it('claims the ENTITY, not the SyncLog row', async () => {
    // Two failed attempts for the same entity must contend with each other, so the key
    // cannot include the SyncLog id.
    const claim = vi.fn().mockResolvedValue({ granted: true })
    await retryFailedAcceleventsSyncs(
      deps({ listFailed: vi.fn().mockResolvedValue([row('recSubA', 'hash-a')]), claim }),
    )

    const key = claim.mock.calls.at(0)?.[0] as string
    expect(key).toContain('recSubA')
    expect(key).not.toContain('recSync-')
    expect(claim.mock.calls.at(0)?.slice(1)).toEqual(['run-1', ACCEL_LEASE_MS])
  })

  it('holds the lease long enough to cover the remote call and its mapping write', () => {
    // Shorter than the 17-minute schedule, longer than one round trip plus a write.
    expect(ACCEL_LEASE_MS).toBeGreaterThan(60_000)
    expect(ACCEL_LEASE_MS).toBeLessThan(17 * 60_000)
  })

  it('lets a contended row through on a later sweep rather than dropping it', async () => {
    // Contention is not failure. The row stays failed in SyncLog, so the next sweep sees
    // it again, which is the whole reason this counter is separate from `failed`.
    const accel = client()
    const result = await retryFailedAcceleventsSyncs(
      deps({
        listFailed: vi.fn().mockResolvedValue([row('recSubA', 'hash-a')]),
        client: accel.value,
        claim: vi.fn().mockResolvedValue({ granted: true }),
      }),
    )

    expect(accel.createSession).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ contended: 0, succeeded: 1 })
  })

  it('does not claim a row that is only going to write a skip log', async () => {
    // That path calls nothing remote and creates nothing. Making it contend would let one
    // stuck sweep hide another sweep's bookkeeping for the length of the lease.
    const source = row('recSubA', 'hash-a')
    const claim = vi.fn().mockResolvedValue({ granted: true })

    const result = await retryFailedAcceleventsSyncs(
      deps({
        listFailed: vi.fn().mockResolvedValue([source]),
        listMappings: vi.fn().mockResolvedValue([mappingFor(source, 'hash-a')]),
        claim,
      }),
    )

    expect(claim).not.toHaveBeenCalled()
    expect(result).toMatchObject({ skipped: 1, contended: 0 })
  })

  it('claims each entity separately, so one contended entity does not block another', async () => {
    const accel = client()
    const claim = vi
      .fn()
      .mockResolvedValueOnce({ granted: false })
      .mockResolvedValueOnce({ granted: true })

    const result = await retryFailedAcceleventsSyncs(
      deps({
        listFailed: vi.fn().mockResolvedValue([row('recSubA', 'hash-a'), row('recSubB', 'hash-b')]),
        client: accel.value,
        claim,
      }),
    )

    expect(accel.createSession).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ found: 2, contended: 1, succeeded: 1 })
  })
})

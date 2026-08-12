// The retry sweep protects a remote integration, so the two important outcomes are
// pinned at its dependency seams: an accepted hash never calls Accelevents again, and
// a failed attempt is replayed with the snapshotted payload.

import { describe, expect, it, vi } from 'vitest'

import {
  type AcceleventsSyncDeps,
  retryFailedAcceleventsSyncs,
} from '@/features/jobs/accelevents-sync'
import type { AccelClient } from '@/services/accelevents/client'
import type { FailedSyncRow, IntegrationMapping } from '@/services/accelevents/sync-types'

const FAILED_SESSION: FailedSyncRow = {
  id: 'recSyncFailed',
  eventId: 'recEvent',
  entityType: 'submission',
  localId: 'recSubmission',
  action: 'create',
  status: 'failed',
  payloadJson:
    '{"title":"Reliable agents","startTime":"2026-10-12T17:00:00.000Z","endTime":"2026-10-12T17:30:00.000Z"}',
  payload: {
    title: 'Reliable agents',
    startTime: '2026-10-12T17:00:00.000Z',
    endTime: '2026-10-12T17:30:00.000Z',
  },
  error: 'temporary outage',
  at: '2026-08-08T12:00:00.000Z',
  requestHash: 'hash-session-v1',
}

function client(): {
  value: AccelClient
  createSession: ReturnType<typeof vi.fn>
  updateSession: ReturnType<typeof vi.fn>
} {
  const createSession = vi.fn().mockResolvedValue({ remoteId: 'ses_remote_1', existed: false })
  const updateSession = vi.fn()
  return {
    value: {
      createSpeaker: vi.fn(),
      updateSpeaker: vi.fn(),
      findSpeakerByEmail: vi.fn(),
      createSession,
      updateSession,
      createTaxonomy: vi.fn(),
    },
    createSession,
    updateSession,
  }
}

function dependencies(
  accelClient: AccelClient,
  mappings: readonly IntegrationMapping[],
): AcceleventsSyncDeps {
  return {
    listFailed: vi.fn().mockResolvedValue([FAILED_SESSION]),
    listMappings: vi.fn().mockResolvedValue(mappings),
    getEventUrl: vi.fn().mockResolvedValue('ai-engineer-sandbox'),
    client: accelClient,
    saveMapping: vi.fn().mockResolvedValue(undefined),
    writeLog: vi.fn().mockResolvedValue(undefined),
    now: () => '2026-08-08T13:00:00.000Z',
    claim: vi.fn().mockResolvedValue({ granted: true }),
    holder: 'run-1',
  }
}

describe('retryFailedAcceleventsSyncs', () => {
  it('makes an accepted payload a no-op when requestHash already matches', async () => {
    const accelClient = client()
    const mapping: IntegrationMapping = {
      id: 'recMapping',
      eventId: FAILED_SESSION.eventId,
      entityType: FAILED_SESSION.entityType,
      localId: FAILED_SESSION.localId,
      remoteId: 'ses_remote_1',
      requestHash: FAILED_SESSION.requestHash,
      syncedAt: '2026-08-08T12:30:00.000Z',
    }
    const deps = dependencies(accelClient.value, [mapping])

    const result = await retryFailedAcceleventsSyncs(deps)

    expect(result).toEqual({
      found: 1,
      retried: 0,
      succeeded: 0,
      skipped: 1,
      failed: 0,
      contended: 0,
    })
    expect(accelClient.createSession).not.toHaveBeenCalled()
    expect(accelClient.updateSession).not.toHaveBeenCalled()
    expect(deps.saveMapping).not.toHaveBeenCalled()
    expect(deps.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'skip', status: 'ok', remoteId: 'ses_remote_1' }),
    )
  })

  it('retries a failed row with its snapshotted payload', async () => {
    const accelClient = client()
    const deps = dependencies(accelClient.value, [])

    const result = await retryFailedAcceleventsSyncs(deps)

    expect(result).toEqual({
      found: 1,
      retried: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      contended: 0,
    })
    expect(accelClient.createSession).toHaveBeenCalledWith(
      'ai-engineer-sandbox',
      FAILED_SESSION.payload,
    )
    expect(deps.saveMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: FAILED_SESSION.eventId,
        localId: FAILED_SESSION.localId,
        remoteId: 'ses_remote_1',
        requestHash: FAILED_SESSION.requestHash,
      }),
    )
    expect(deps.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', status: 'ok', remoteId: 'ses_remote_1' }),
    )
  })
})

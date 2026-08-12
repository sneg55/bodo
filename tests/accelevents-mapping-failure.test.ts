// The worst thing this integration can do: create the same entity twice on somebody
// else's event, and show nothing about it in bodo.
//
// The state that produces it is one line wide. `pushEntity` calls the far side, the far
// side ACCEPTS and answers with an id, and the `IntegrationMappings` write immediately
// after it fails (Airtable answers 429 under exactly the load a full-event walk makes).
// The entity now exists remotely and bodo holds no record of it.
//
// What used to happen next: the failed SyncLog row recorded `attempt.mapping?.remoteId`,
// which is absent for a create, so the row said "a create that never landed". The sweep
// found no mapping either, `chooseRemoteAction` chose `create`, and Accelevents got a
// second session. Nothing anywhere reported a duplicate.
//
// The two halves of the fix are pinned together here on purpose: carrying the id onto the
// failed row is only worth anything because the replay reads it.

import { describe, expect, it, vi } from 'vitest'

import {
  type AcceleventsSyncDeps,
  retryFailedAcceleventsSyncs,
} from '@/features/jobs/accelevents-sync'
import type { AccelClient } from '@/services/accelevents/client'
import { syncEvent } from '@/services/accelevents/sync'
import type { FailedSyncRow, SyncLogWrite } from '@/services/accelevents/sync-types'
import { ADA, EVENT_ID, harness } from './fixtures/accelevents-forward'

/** A walk whose remote calls all succeed and whose mapping write always fails. */
function walkWithBrokenMappings() {
  return harness({
    saveMapping: () => Promise.reject(new Error('Airtable is unavailable')),
  })
}

function speakerLog(logs: readonly SyncLogWrite[]): SyncLogWrite | undefined {
  return logs.find((log) => log.entityType === 'speaker')
}

describe('a remote create whose mapping write fails', () => {
  it('records the id the far side returned on the failed row', async () => {
    const run = walkWithBrokenMappings()

    await syncEvent(run.deps, EVENT_ID)

    const log = speakerLog(run.logs)
    expect(log?.status).toBe('failed')
    expect(log?.action).toBe('create')
    // Without this the row carries no id at all, and the retry has nothing to tell it the
    // speaker is already there.
    expect(log?.remoteId).toBe('spk_3')
  })

  it('still lets the session that references the speaker be sent with the right cast', async () => {
    const run = walkWithBrokenMappings()

    const result = await syncEvent(run.deps, EVENT_ID)

    // The entity IS on the far side, so holding its dependents back would punish a
    // bookkeeping failure with a half-published programme.
    expect(run.calls).toContain('createSession')
    expect(result.counts.speaker.failed).toBe(1)
  })
})

/** The failed row the walk above wrote, as `listFailedSyncLogs` hands it back. */
function rowFrom(log: SyncLogWrite, requestHash: string): FailedSyncRow {
  return {
    id: 'recSyncFailed',
    eventId: log.eventId,
    entityType: 'speaker',
    localId: log.localId,
    remoteId: log.remoteId,
    action: log.action,
    status: 'failed',
    payloadJson: JSON.stringify(log.payload),
    payload: { firstName: ADA.firstName, lastName: ADA.lastName, email: ADA.email },
    at: log.at,
    requestHash,
  }
}

function sweepDeps(row: FailedSyncRow, client: AccelClient): AcceleventsSyncDeps {
  return {
    listFailed: vi.fn().mockResolvedValue([row]),
    // EMPTY, which is the whole point: the mapping write is what failed, so the sweep has
    // only the remote id on the row to go on.
    listMappings: vi.fn().mockResolvedValue([]),
    getEventUrl: vi.fn().mockResolvedValue('ai-engineer-sandbox'),
    client,
    saveMapping: vi.fn().mockResolvedValue(undefined),
    writeLog: vi.fn().mockResolvedValue(undefined),
    now: () => '2026-08-09T13:00:00.000Z',
    claim: vi.fn().mockResolvedValue({ granted: true }),
    holder: 'sweep-1',
  }
}

describe('the sweep replaying that row', () => {
  it('updates the speaker it already created instead of creating a second one', async () => {
    const run = walkWithBrokenMappings()
    await syncEvent(run.deps, EVENT_ID)
    const log = speakerLog(run.logs)
    expect(log).toBeDefined()

    const createSpeaker = vi.fn()
    const updateSpeaker = vi.fn().mockResolvedValue({ remoteId: 'spk_3', existed: true })
    const client = {
      createSpeaker,
      updateSpeaker,
      findSpeakerByEmail: vi.fn(),
      createSession: vi.fn(),
      updateSession: vi.fn(),
      createTaxonomy: vi.fn(),
    } satisfies AccelClient
    const deps = sweepDeps(rowFrom(log as SyncLogWrite, 'hash-speaker-v1'), client)

    const result = await retryFailedAcceleventsSyncs(deps)

    expect(createSpeaker).not.toHaveBeenCalled()
    expect(updateSpeaker).toHaveBeenCalledWith('ai-engineer-sandbox', 'spk_3', expect.anything())
    expect(result.succeeded).toBe(1)
    // And the mapping the first attempt could not write is finally there.
    expect(deps.saveMapping).toHaveBeenCalledWith(
      expect.objectContaining({ remoteId: 'spk_3', localId: ADA.id }),
    )
  })

  it('still creates when the row carries no remote id, because nothing landed', async () => {
    const createSpeaker = vi.fn().mockResolvedValue({ remoteId: 'spk_new', existed: false })
    const client = {
      createSpeaker,
      updateSpeaker: vi.fn(),
      findSpeakerByEmail: vi.fn(),
      createSession: vi.fn(),
      updateSession: vi.fn(),
      createTaxonomy: vi.fn(),
    } satisfies AccelClient
    const row: FailedSyncRow = {
      id: 'recSyncFailed2',
      eventId: EVENT_ID,
      entityType: 'speaker',
      localId: ADA.id,
      action: 'create',
      status: 'failed',
      payloadJson: '{}',
      payload: { firstName: 'Ada', lastName: 'Lovelace', email: ADA.email },
      at: '2026-08-09T12:00:00.000Z',
      requestHash: 'hash-speaker-v1',
    }

    await retryFailedAcceleventsSyncs(sweepDeps(row, client))

    expect(createSpeaker).toHaveBeenCalledOnce()
  })
})

/**
 * The same one-line window, on a track or a tag, where it used to fail FOREVER.
 *
 * `AccelClient` exposes `createTaxonomy` and no update at all, so the replay of a taxonomy
 * whose create landed and whose mapping write then failed hit a `throw` on every sweep: a
 * fresh failed attempt written each time, and the mapping never restored, for a remote
 * record whose id was sitting on the row the whole while. That state needs nothing from the
 * far side, so nothing is sent to it.
 */
function taxonomyRow(remoteId: string | undefined): FailedSyncRow {
  return {
    id: 'recSyncFailedTrack',
    eventId: EVENT_ID,
    entityType: 'track',
    localId: 'recTrack1',
    remoteId,
    action: 'create',
    status: 'failed',
    payloadJson: '{"type":"TRACKS","name":"AI"}',
    payload: { type: 'TRACKS', name: 'AI' },
    at: '2026-08-09T12:00:00.000Z',
    requestHash: 'hash-track-v1',
  }
}

function taxonomyClient() {
  const createTaxonomy = vi.fn()
  const client = {
    createSpeaker: vi.fn(),
    updateSpeaker: vi.fn(),
    findSpeakerByEmail: vi.fn(),
    createSession: vi.fn(),
    updateSession: vi.fn(),
    createTaxonomy,
  } satisfies AccelClient
  return { client, createTaxonomy }
}

describe('a taxonomy create whose mapping write fails', () => {
  it('restores the mapping from the row, without calling Accelevents again', async () => {
    const { client, createTaxonomy } = taxonomyClient()
    const deps = sweepDeps(taxonomyRow('tax_7'), client)

    const result = await retryFailedAcceleventsSyncs(deps)

    // The record is already theirs and its id is on the row, so the mapping is the only
    // thing missing. Sending the create again would duplicate the remote track; throwing
    // left the mapping missing and the row failing on every sweep from then on.
    expect(createTaxonomy).not.toHaveBeenCalled()
    expect(deps.saveMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'track',
        localId: 'recTrack1',
        remoteId: 'tax_7',
        requestHash: 'hash-track-v1',
      }),
    )
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('still creates when the row carries no remote id, because nothing landed', async () => {
    const { client, createTaxonomy } = taxonomyClient()
    createTaxonomy.mockResolvedValue({ remoteId: 'tax_new', existed: false })

    await retryFailedAcceleventsSyncs(sweepDeps(taxonomyRow(undefined), client))

    expect(createTaxonomy).toHaveBeenCalledOnce()
  })

  it('leaves a genuine rename a visible failure, because there is no endpoint for it', async () => {
    const { client, createTaxonomy } = taxonomyClient()
    const deps = {
      ...sweepDeps(taxonomyRow('tax_7'), client),
      // A mapping exists and its hash has moved, so the local track was RENAMED and the new
      // name has to reach the far side. Nothing in `AccelClient` can carry it.
      listMappings: vi.fn().mockResolvedValue([
        {
          id: 'recMap1',
          eventId: EVENT_ID,
          entityType: 'track',
          localId: 'recTrack1',
          remoteId: 'tax_7',
          requestHash: 'hash-track-v0',
          syncedAt: '2026-08-09T11:00:00.000Z',
        },
      ]),
    }

    const result = await retryFailedAcceleventsSyncs(deps)

    // A BOUND, not a fix, and deliberately the honest half: writing the mapping here would
    // claim the rename reached Accelevents when it never left bodo.
    expect(createTaxonomy).not.toHaveBeenCalled()
    expect(deps.saveMapping).not.toHaveBeenCalled()
    expect(result.failed).toBe(1)
  })
})

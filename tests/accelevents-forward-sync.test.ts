// The forward walk pushes into a system bodo does not own, so what is pinned here is what
// is expensive to get wrong on the far side: prerequisites land before the session that
// references them, an accepted payload is never sent twice, a duplicate email resolves to
// the existing remote speaker instead of failing forever, and an entity that cannot be
// expressed is held back rather than pushed half-built.
//
// Every dependency is a fake (tests/fixtures/accelevents-forward.ts). Nothing here reaches
// Airtable or the network, which is the whole reason `ForwardSyncDeps` exists.

import { describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { SessionPayload } from '@/services/accelevents/client'
import {
  ACCEL_REMOTE_ID_PREFIX,
  fromNamespacedRemoteId,
  namespaceOf,
  toNamespacedRemoteId,
} from '@/services/accelevents/remote-id'
import { syncEvent, syncSession } from '@/services/accelevents/sync'
import { speakerPayload, tagPayload, trackPayload } from '@/services/accelevents/sync-payloads'
import {
  ADA,
  cast,
  EVENT_ID,
  harness,
  hashOf,
  mapping,
  NAMELESS,
  ROOM,
  submission,
  TAG,
  TRACK,
} from './fixtures/accelevents-forward'

const duplicateEmail = (): AppError =>
  new AppError(ErrorIds.ACCEL_DUPLICATE_EMAIL, 'speaker email already exists', {})

describe('syncEvent, dependency order', () => {
  it('sends tracks and tags, then speakers, then the session that references them', async () => {
    const run = harness()

    const result = await syncEvent(run.deps, EVENT_ID)

    expect(run.calls).toEqual([
      'createTaxonomy:TRACKS',
      'createTaxonomy:TAGS',
      'createSpeaker',
      'createSession',
    ])
    // The ids on the session are the REMOTE ids the earlier phases were assigned, which is
    // the entire reason this is one ordered walk rather than four independent calls.
    const sent = run.sessionPayloads[0] as SessionPayload
    expect(sent.trackIds).toEqual(['tax_1'])
    expect(sent.tagIds).toEqual(['tax_2'])
    expect(sent.speakerIds).toEqual(['spk_3'])
    expect(sent.room).toBe(ROOM.name)
    expect(sent.description).toBe('<p>How to keep them up.</p>')
    expect(result.counts.submission.created).toBe(1)
    expect(result.blocked).toBe(0)
  })

  it('writes a mapping and an ok log row for every entity it lands', async () => {
    const run = harness()

    await syncEvent(run.deps, EVENT_ID)

    expect(run.mappingWrites.map((write) => write.localId)).toEqual([
      TRACK.id,
      TAG.id,
      ADA.id,
      'recSub',
    ])
    expect(run.logs.every((log) => log.status === 'ok' && log.action === 'create')).toBe(true)
  })

  it('pushes only accepted submissions and only the speakers cast in them', async () => {
    const run = harness({ submissions: [submission({ status: 'pending' })] })

    const result = await syncEvent(run.deps, EVENT_ID)

    expect(run.calls).toEqual(['createTaxonomy:TRACKS', 'createTaxonomy:TAGS'])
    expect(result.counts.speaker.created).toBe(0)
    expect(result.counts.submission.created).toBe(0)
  })
})

describe('syncEvent, an already accepted payload', () => {
  it('calls nothing for it and still writes a skip row, per §5.7', async () => {
    const run = harness({
      mappings: [
        mapping('track', TRACK.id, 'tax_a', await hashOf(trackPayload(TRACK.name))),
        mapping('tag', TAG.id, 'tax_b', await hashOf(tagPayload(TAG.name))),
        mapping('speaker', ADA.id, 'spk_a', await hashOf(speakerPayload(ADA))),
      ],
    })

    const result = await syncEvent(run.deps, EVENT_ID)

    expect(run.calls).toEqual(['createSession'])
    expect(result.counts.track.skipped).toBe(1)
    expect(result.counts.tag.skipped).toBe(1)
    expect(result.counts.speaker.skipped).toBe(1)
    expect(run.logs.filter((log) => log.action === 'skip')).toHaveLength(3)
    // A skip still resolves the remote id, so the session behind it can reference it.
    expect((run.sessionPayloads[0] as SessionPayload).speakerIds).toEqual(['spk_a'])
  })

  it('updates rather than creates when a mapping exists with a different hash', async () => {
    const run = harness({ mappings: [mapping('speaker', ADA.id, 'spk_existing', 'stale-hash')] })

    const result = await syncEvent(run.deps, EVENT_ID)

    expect(run.calls).toContain('updateSpeaker')
    expect(run.speakerCreates).toBe(0)
    expect(result.counts.speaker.updated).toBe(1)
  })
})

describe('syncEvent, the duplicate-email branch', () => {
  it('resolves the existing remote speaker by lookup and maps it', async () => {
    const run = harness({
      remote: {
        createSpeaker: () => Promise.reject(duplicateEmail()),
        findSpeakerByEmail: () => Promise.resolve('spk_already_there'),
      },
    })

    const result = await syncEvent(run.deps, EVENT_ID)

    expect(run.calls).toContain('findSpeakerByEmail')
    expect(run.mappingWrites).toContainEqual({ localId: ADA.id, remoteId: 'spk_already_there' })
    expect(result.counts.speaker.failed).toBe(0)
    // And the session behind it uses the id the lookup found.
    expect((run.sessionPayloads[0] as SessionPayload).speakerIds).toEqual(['spk_already_there'])
  })

  it('fails the speaker when the lookup cannot find the address they rejected', async () => {
    const run = harness({ remote: { createSpeaker: () => Promise.reject(duplicateEmail()) } })

    const result = await syncEvent(run.deps, EVENT_ID)

    expect(result.counts.speaker.failed).toBe(1)
    expect(run.logs.some((log) => log.status === 'failed' && log.localId === ADA.id)).toBe(true)
    // The session is held back rather than pushed without its speaker.
    expect(run.calls).not.toContain('createSession')
    expect(result.blocked).toBe(1)
  })
})

describe('syncEvent, what it refuses to send', () => {
  it('holds back an accepted session with no place in time, and logs nothing for it', async () => {
    const run = harness({ submissions: [submission({ startsAt: undefined, endsAt: undefined })] })

    const result = await syncEvent(run.deps, EVENT_ID)

    expect(run.calls).not.toContain('createSession')
    expect(result.blocked).toBe(1)
    // Nothing loggable: a payload that fails `sessionPayloadSchema` would make every later
    // read of SyncLog throw, which aborts the retry sweep for every event.
    expect(run.logs.some((log) => log.entityType === 'submission')).toBe(false)
  })

  it('holds back a speaker with no email, since the address is the remote identity', async () => {
    const run = harness({ submissions: [submission({ participants: [cast(NAMELESS)] })] })

    const result = await syncEvent(run.deps, EVENT_ID)

    expect(run.speakerCreates).toBe(0)
    // Two: the speaker who cannot be expressed, and the session that needed their id.
    expect(result.blocked).toBe(2)
  })

  it('records a failed remote call as a failed log row, which is the retry queue', async () => {
    const run = harness({
      remote: {
        createSession: () =>
          Promise.reject(new AppError(ErrorIds.ACCEL_UNAVAILABLE, 'retryable', {})),
      },
    })

    const result = await syncEvent(run.deps, EVENT_ID)

    expect(result.counts.submission.failed).toBe(1)
    const failed = run.logs.find((log) => log.status === 'failed')
    expect(failed?.entityType).toBe('submission')
    expect(failed?.payload).toMatchObject({ title: 'Reliable agents' })
    expect(run.mappingWrites.map((write) => write.localId)).not.toContain('recSub')
  })

  it('counts an entity another caller holds as contended, and calls nothing', async () => {
    const run = harness({ granted: false })

    const result = await syncEvent(run.deps, EVENT_ID)

    expect(run.calls).toEqual([])
    expect(result.counts.track.contended).toBe(1)
    expect(run.logs).toHaveLength(0)
  })

  it('finishes the walk when an ok log row cannot be written, since the entity landed', async () => {
    const writeLog = vi
      .fn<(write: unknown) => Promise<void>>()
      .mockRejectedValueOnce(new AppError(ErrorIds.DATA_WRITE_FAIL, 'airtable said 429', {}))
      .mockResolvedValue(undefined)
    const run = harness({ writeLog })

    const result = await syncEvent(run.deps, EVENT_ID)

    // The track's mapping was saved, so it IS synced and its remote id is still resolved
    // for the session behind it. Reporting the lost diagnostic row as a failure would hold
    // back a programme over an entity that is correct on their side.
    expect(result.counts.track.created).toBe(1)
    expect(run.calls).toContain('createSession')
  })

  it('counts the entity and keeps going when a FAILED row cannot be written', async () => {
    const writeLog = vi
      .fn<(write: unknown) => Promise<void>>()
      .mockRejectedValue(new AppError(ErrorIds.DATA_WRITE_FAIL, 'airtable said 429', {}))
    const run = harness({
      writeLog,
      remote: {
        createSpeaker: () => Promise.reject(new AppError(ErrorIds.ACCEL_UNAVAILABLE, 'down', {})),
      },
    })

    const result = await syncEvent(run.deps, EVENT_ID)

    // That row is the retry queue rather than diagnostics, so its write is allowed to
    // throw. The walk's per-entity guard counts the speaker and moves on; the alternative,
    // which this pins, is abandoning every remaining entity silently and mid-order.
    expect(result.counts.speaker.failed).toBe(1)
    expect(result.counts.track.created).toBe(1)
    expect(result.blocked).toBe(1)
  })
})

describe('syncSession', () => {
  it('pushes this submission’s own prerequisites first, in order', async () => {
    const run = harness()

    const result = await syncSession(run.deps, 'recSub')

    expect(run.calls).toEqual([
      'createTaxonomy:TRACKS',
      'createTaxonomy:TAGS',
      'createSpeaker',
      'createSession',
    ])
    expect(result.eventId).toBe(EVENT_ID)
  })

  it('leaves out taxonomy this submission does not use', async () => {
    const run = harness({ submissions: [submission({ trackId: undefined, tagIds: [] })] })

    await syncSession(run.deps, 'recSub')

    expect(run.calls).toEqual(['createSpeaker', 'createSession'])
  })
})

describe('the accelevents remote-id namespace', () => {
  it('writes prefixed and reads its own prefix back', () => {
    expect(toNamespacedRemoteId('spk_1')).toBe('accelevents:spk_1')
    expect(fromNamespacedRemoteId('accelevents:spk_1')).toBe('spk_1')
    expect(toNamespacedRemoteId('accelevents:spk_1')).toBe('accelevents:spk_1')
  })

  it('accepts a legacy bare id, because nothing else has ever written that column', () => {
    expect(fromNamespacedRemoteId('12345')).toBe('12345')
    expect(namespaceOf('12345')).toBeUndefined()
  })

  it('refuses another provider, which is the collision the prefix exists to stop', () => {
    expect(fromNamespacedRemoteId('sessionize:14022')).toBeUndefined()
    expect(fromNamespacedRemoteId('sessionboard:abc')).toBeUndefined()
    expect(namespaceOf('sessionize:14022')).toBe('sessionize')
    expect(ACCEL_REMOTE_ID_PREFIX).toBe('accelevents')
  })
})

// Who may replace a SPEAKER's headshot from the admin roster, and in what order it happens.
//
// This branch answers two questions where the event image branch answers one, and the second
// is the one a role check cannot see: holding `admin` on the event in the URL says the caller
// may edit that event's people, and says nothing about whether the speaker id they posted is
// one of them. Both ids arrive on the query string, so without the roster resolution an admin
// of event A could overwrite the photograph of a speaker who is only on event B by knowing
// their record id. Every case below distinguishes the two failures.
//
// `@/features/auth/wiring` is replaced by the actual `createEventRoleGuards` over a stub
// membership loader, as in tests/settings-event-image-upload.test.ts, so every refusal is
// produced by the code the rest of the admin surface uses rather than by a mock that agrees
// with the test.
//
// The ordering assertions matter as much as the refusals: bytes are never stored before the
// caller is authorized AND the speaker is resolved, and the Speakers row is written only
// after the object is stored and HEADed (the HEAD lives inside `putObject`, mocked here and
// tested in tests/uploads-put.test.ts).

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionSubject } from '@/features/auth/tokens'
import { buildObjectKey } from '@/services/storage/upload-limits'
import type { EventMembership, Speaker } from '@/types/domain'

import { ADMIN, errorIdOf, IMPERSONATED, membershipRow, SPEAKER, T0 } from './helpers/auth-fakes'

const EVENT_A = 'recEventA'
const EVENT_B = 'recEventB'
/** On EVENT_A's roster. */
const SPEAKER_A = 'recSpeakerA'
/** On EVENT_B's roster and nowhere else. The whole point of this file. */
const SPEAKER_B = 'recSpeakerB'

const mocks = vi.hoisted(() => ({
  subject: undefined as SessionSubject | undefined,
  memberships: [] as EventMembership[],
  /** Keyed by event id, which is what makes the cross-event case expressible. */
  rosters: new Map<string, Speaker[]>(),
  putObject: vi.fn(),
  saveSpeakerProfile: vi.fn(),
  listSpeakers: vi.fn(),
  order: [] as string[],
}))

vi.mock('@/features/auth/wiring', async () => {
  const { createEventRoleGuards } = await import('@/features/auth/guards')
  const guards = createEventRoleGuards({
    loadMemberships: (userId) =>
      Promise.resolve(
        mocks.memberships.filter((row) => row.userId === userId) as readonly EventMembership[],
      ),
  })
  return {
    requireEventRole: async (eventId: string, role: 'admin' | 'reviewer') =>
      await guards.requireEventRole({
        nowMs: T0,
        eventId,
        role,
        ...(mocks.subject === undefined
          ? { readSubject: () => Promise.resolve(undefined) }
          : { subject: mocks.subject }),
      }),
  }
})

vi.mock('@/services/airtable/queries', () => ({ listSpeakers: mocks.listSpeakers }))
vi.mock('@/services/airtable/mutations-speakers', () => ({
  saveSpeakerProfile: mocks.saveSpeakerProfile,
}))
vi.mock('@/services/storage/uploads', () => ({
  putObject: mocks.putObject,
  publicUrlFor: (objectKey: string, visibility: string) =>
    visibility === 'public' ? `https://files.example/${objectKey}` : 'private',
}))

const { uploadSpeakerHeadshot } = await import('@/features/speakers/headshot-upload')

function body(): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.close()
    },
  })
}

function speakerRow(id: string, email: string): Speaker {
  return { id, email, firstName: 'Ada', lastName: 'Okafor' } as Speaker
}

function headshotUpload(eventId = EVENT_A, speakerId = SPEAKER_A) {
  return {
    eventId,
    speakerId,
    filename: 'ada.png',
    contentType: 'image/png',
    declaredBytes: 2048,
    body: body(),
  }
}

beforeEach(() => {
  mocks.order.length = 0
  mocks.subject = ADMIN
  // recUser1 is ADMIN and the organizer of EVENT_A; it is also the admin named in
  // IMPERSONATED's claim, which is what makes the impersonation case meaningful.
  mocks.memberships = [
    membershipRow(EVENT_A, 'admin', 'recUser1'),
    membershipRow(EVENT_A, 'reviewer', 'recUser2'),
    membershipRow(EVENT_B, 'admin', 'recUser3'),
  ]
  mocks.rosters = new Map([
    [EVENT_A, [speakerRow(SPEAKER_A, 'ada@example.com')]],
    [EVENT_B, [speakerRow(SPEAKER_B, 'grace@example.com')]],
  ])

  mocks.putObject.mockReset()
  mocks.saveSpeakerProfile.mockReset()
  mocks.listSpeakers.mockReset()

  mocks.listSpeakers.mockImplementation((eventId: string) => {
    mocks.order.push('roster')
    return Promise.resolve(mocks.rosters.get(eventId) ?? [])
  })
  mocks.putObject.mockImplementation((request: { kind: string; speakerId?: string }) => {
    mocks.order.push('put')
    return Promise.resolve({
      objectKey: buildObjectKey(request as Parameters<typeof buildObjectKey>[0], 'n1'),
      size: 2048,
      contentType: 'image/png',
      visibility: 'public',
    })
  })
  mocks.saveSpeakerProfile.mockImplementation(() => {
    mocks.order.push('write')
    return Promise.resolve()
  })
})

describe('an organizer replacing a headshot on their own event', () => {
  it('stores the object and puts the derived URL on the speaker', async () => {
    const stored = await uploadSpeakerHeadshot(headshotUpload())

    expect(stored).toMatchObject({
      objectKey: 'speaker-headshot/recSpeakerA/n1-ada.png',
      url: 'https://files.example/speaker-headshot/recSpeakerA/n1-ada.png',
      speakerId: SPEAKER_A,
      size: 2048,
      contentType: 'image/png',
      visibility: 'public',
    })
  })

  it('keys the object under the speaker, not under the event that was authorized', async () => {
    await uploadSpeakerHeadshot(headshotUpload())

    const request = mocks.putObject.mock.calls.at(0)?.[0] as {
      kind?: string
      eventId?: string
      speakerId?: string
    }
    expect(request.kind).toBe('speaker-headshot')
    expect(request.speakerId).toBe(SPEAKER_A)
    expect(request.eventId).toBeUndefined()
  })

  it('writes through the shared profile writer, which is what expires the tags', async () => {
    await uploadSpeakerHeadshot(headshotUpload())

    expect(mocks.saveSpeakerProfile).toHaveBeenCalledWith(
      {
        eventId: EVENT_A,
        speakerId: SPEAKER_A,
        // The STORED address, never one posted with the file: this write must not be able to
        // repoint a speaker record at another account.
        draft: {
          email: 'ada@example.com',
          headshotUrl: expect.stringContaining('speaker-headshot/recSpeakerA/'),
        },
      },
      'route',
    )
  })

  it('resolves the speaker, then stores, then writes, in that order', async () => {
    await uploadSpeakerHeadshot(headshotUpload())

    expect(mocks.order).toEqual(['roster', 'put', 'write'])
  })

  it('records nothing when the store fails, so no column points at absent bytes', async () => {
    mocks.putObject.mockRejectedValue(new Error('R2 said no'))

    await expect(uploadSpeakerHeadshot(headshotUpload())).rejects.toThrow(/R2 said no/)
    expect(mocks.saveSpeakerProfile).not.toHaveBeenCalled()
  })
})

describe('the speaker id is resolved against the event, never trusted', () => {
  it('refuses a speaker who is only on another event, with nothing stored', async () => {
    // The case a role check cannot catch: this caller genuinely administers EVENT_A.
    expect(
      await errorIdOf(async () => await uploadSpeakerHeadshot(headshotUpload(EVENT_A, SPEAKER_B))),
    ).toBe('E_DATA_001')
    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.saveSpeakerProfile).not.toHaveBeenCalled()
  })

  it('refuses an id that names no speaker at all, with the same answer', async () => {
    // Not-found either way, so the failure cannot be read as "this record exists but is
    // not yours" and used to probe for ids.
    expect(
      await errorIdOf(
        async () => await uploadSpeakerHeadshot(headshotUpload(EVENT_A, 'recNobody')),
      ),
    ).toBe('E_DATA_001')
    expect(mocks.putObject).not.toHaveBeenCalled()
  })

  it('reads the roster of the AUTHORIZED event, not one named anywhere else', async () => {
    await uploadSpeakerHeadshot(headshotUpload())

    expect(mocks.listSpeakers).toHaveBeenCalledWith(EVENT_A)
  })

  it('lets the other event’s own admin through for the same speaker', async () => {
    // The mirror of the first case: SPEAKER_B is refused to EVENT_A's admin and allowed to
    // EVENT_B's, which is what shows the refusal is about the pairing and not about the id.
    mocks.subject = { kind: 'user', userId: 'recUser3' }

    const stored = await uploadSpeakerHeadshot(headshotUpload(EVENT_B, SPEAKER_B))

    expect(stored.objectKey).toBe('speaker-headshot/recSpeakerB/n1-ada.png')
  })
})

describe('subjects that are refused, with nothing stored and no roster read', () => {
  it('refuses a speaker session, which is what the portal has', async () => {
    mocks.subject = SPEAKER

    expect(await errorIdOf(async () => await uploadSpeakerHeadshot(headshotUpload()))).toBe(
      'E_AUTH_005',
    )
    expect(mocks.listSpeakers).not.toHaveBeenCalled()
    expect(mocks.putObject).not.toHaveBeenCalled()
  })

  it('refuses an impersonated speaker session, whose claim names this event’s admin', async () => {
    mocks.subject = IMPERSONATED

    expect(await errorIdOf(async () => await uploadSpeakerHeadshot(headshotUpload()))).toBe(
      'E_AUTH_005',
    )
    expect(mocks.putObject).not.toHaveBeenCalled()
  })

  it('refuses a reviewer on the very event being edited', async () => {
    mocks.subject = { kind: 'user', userId: 'recUser2' }

    expect(await errorIdOf(async () => await uploadSpeakerHeadshot(headshotUpload()))).toBe(
      'E_AUTH_005',
    )
    expect(mocks.putObject).not.toHaveBeenCalled()
  })

  it('refuses an admin of another event before the roster is even read', async () => {
    mocks.subject = { kind: 'user', userId: 'recUser3' }

    expect(await errorIdOf(async () => await uploadSpeakerHeadshot(headshotUpload(EVENT_A)))).toBe(
      'E_AUTH_005',
    )
    expect(mocks.listSpeakers).not.toHaveBeenCalled()
    expect(mocks.putObject).not.toHaveBeenCalled()
  })

  it('refuses a caller with no session', async () => {
    mocks.subject = undefined

    expect(await errorIdOf(async () => await uploadSpeakerHeadshot(headshotUpload()))).toBe(
      'E_AUTH_004',
    )
    expect(mocks.putObject).not.toHaveBeenCalled()
  })
})

// Who may replace an event's logo, and in what order it happens.
//
// This is the gap the Image Settings dropzone used to have: `/api/files/upload` authorized
// with `requireSpeaker()`, so an organizer had no path through it. The organizer branch has
// to answer a different question, and answering it wrongly is not a broken screen but an
// authorization hole, so the REAL guard runs here. `@/features/auth/wiring` is replaced by
// the actual `createEventRoleGuards` over a stub membership loader, which means every
// refusal below is produced by the same code the rest of the admin surface uses rather than
// by a mock that agrees with the test.
//
// Four subjects must be refused, and each one is a distinct route to the same object key:
//
//   - a SPEAKER session, which is what the portal has,
//   - an IMPERSONATED speaker session, which is an organizer acting as a speaker: refused
//     even though the admin named in its claim holds `admin` on the event, because
//     capability comes from the subject on the request and never from that claim,
//   - a REVIEWER on the very event being edited, who holds a membership and not this one,
//   - an admin on a DIFFERENT event, which is the "write into someone else's prefix by
//     asking to" case.
//
// The ordering assertions matter as much: bytes are never stored before the caller is
// authorized, and the Events column is written only after the object is stored and HEADed
// (the HEAD lives inside `putObject`, which is mocked here and tested in
// tests/uploads-put.test.ts).

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionSubject } from '@/features/auth/tokens'
import { buildObjectKey } from '@/services/storage/upload-limits'
import type { EventMembership } from '@/types/domain'

import { ADMIN, errorIdOf, IMPERSONATED, membershipRow, SPEAKER, T0 } from './helpers/auth-fakes'

const EVENT_A = 'recEventA'
const EVENT_B = 'recEventB'

const mocks = vi.hoisted(() => ({
  /** The session on the request. `undefined` stands for no session at all. */
  subject: undefined as SessionSubject | undefined,
  memberships: [] as EventMembership[],
  putObject: vi.fn(),
  setEventImage: vi.fn(),
  /** Call order across the mocks, which is half of what this file asserts. */
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
        // A missing subject is "no session cookie", not "read the cookie store": there is no
        // request scope here, so `next/headers` would throw something unrelated.
        ...(mocks.subject === undefined
          ? { readSubject: () => Promise.resolve(undefined) }
          : { subject: mocks.subject }),
      }),
  }
})

vi.mock('@/services/storage/uploads', () => ({
  putObject: mocks.putObject,
  publicUrlFor: (objectKey: string, visibility: string) =>
    visibility === 'public' ? `https://files.example/${objectKey}` : 'private',
}))

vi.mock('@/services/airtable/mutations-event', () => ({ setEventImage: mocks.setEventImage }))

const { uploadEventImage } = await import('@/features/settings/event-image-upload')

function body(): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.close()
    },
  })
}

function logoUpload(eventId = EVENT_A) {
  return {
    kind: 'event-logo' as const,
    eventId,
    filename: 'logo.png',
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

  mocks.putObject.mockReset()
  mocks.setEventImage.mockReset()

  mocks.putObject.mockImplementation((request: { kind: string; eventId?: string }) => {
    mocks.order.push('put')
    return Promise.resolve({
      objectKey: buildObjectKey(request as Parameters<typeof buildObjectKey>[0], 'n1'),
      size: 2048,
      contentType: 'image/png',
      visibility: 'public',
    })
  })
  mocks.setEventImage.mockImplementation(() => {
    mocks.order.push('write')
    return Promise.resolve({ id: EVENT_A })
  })
})

describe('an organizer replacing the logo', () => {
  it('stores the object and puts the derived URL on the event', async () => {
    const stored = await uploadEventImage(logoUpload())

    expect(stored).toMatchObject({
      objectKey: 'event-logo/recEventA/n1-logo.png',
      url: 'https://files.example/event-logo/recEventA/n1-logo.png',
      field: 'logoUrl',
      size: 2048,
      contentType: 'image/png',
      visibility: 'public',
    })
  })

  it('keys the object under the event that was authorized, not under a speaker', async () => {
    await uploadEventImage(logoUpload())

    const request = mocks.putObject.mock.calls.at(0)?.[0] as {
      eventId?: string
      speakerId?: string
    }
    expect(request.eventId).toBe(EVENT_A)
    expect(request.speakerId).toBeUndefined()
  })

  it('writes the column the kind names, through the route origin', async () => {
    await uploadEventImage({ ...logoUpload(), kind: 'event-background' })

    expect(mocks.setEventImage).toHaveBeenCalledWith(
      {
        eventId: EVENT_A,
        field: 'backgroundUrl',
        url: expect.stringContaining('event-background/'),
      },
      'route',
    )
  })

  it('writes the event only after the bytes are stored and verified', async () => {
    await uploadEventImage(logoUpload())

    expect(mocks.order).toEqual(['put', 'write'])
  })

  it('records nothing when the store fails, so no column points at absent bytes', async () => {
    mocks.putObject.mockRejectedValue(new Error('R2 said no'))

    await expect(uploadEventImage(logoUpload())).rejects.toThrow(/R2 said no/)
    expect(mocks.setEventImage).not.toHaveBeenCalled()
  })
})

describe('subjects that are refused, with nothing stored', () => {
  it('refuses a speaker session', async () => {
    mocks.subject = SPEAKER

    expect(await errorIdOf(async () => await uploadEventImage(logoUpload()))).toBe('E_AUTH_005')
    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.setEventImage).not.toHaveBeenCalled()
  })

  it('refuses an impersonated speaker session, whose claim names this event’s admin', async () => {
    // The whole point of impersonation acting AS a speaker: the organizer's own role does
    // not follow them into the portal, so nothing they reach from there can edit the event.
    mocks.subject = IMPERSONATED

    expect(await errorIdOf(async () => await uploadEventImage(logoUpload()))).toBe('E_AUTH_005')
    expect(mocks.putObject).not.toHaveBeenCalled()
  })

  it('refuses a reviewer on the very event being edited', async () => {
    mocks.subject = { kind: 'user', userId: 'recUser2' }

    expect(await errorIdOf(async () => await uploadEventImage(logoUpload()))).toBe('E_AUTH_005')
    expect(mocks.putObject).not.toHaveBeenCalled()
  })

  it('refuses an admin of another event, which is the prefix-crossing case', async () => {
    mocks.subject = { kind: 'user', userId: 'recUser3' }

    expect(await errorIdOf(async () => await uploadEventImage(logoUpload(EVENT_A)))).toBe(
      'E_AUTH_005',
    )
    expect(mocks.putObject).not.toHaveBeenCalled()
  })

  it('refuses a caller with no session', async () => {
    mocks.subject = undefined

    expect(await errorIdOf(async () => await uploadEventImage(logoUpload()))).toBe('E_AUTH_004')
    expect(mocks.putObject).not.toHaveBeenCalled()
  })

  it('refuses an event id nobody has a membership on, before any bytes move', async () => {
    expect(await errorIdOf(async () => await uploadEventImage(logoUpload('recNotAnEvent')))).toBe(
      'E_AUTH_005',
    )
    expect(mocks.putObject).not.toHaveBeenCalled()
  })
})

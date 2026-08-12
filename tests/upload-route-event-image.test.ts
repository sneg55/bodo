// Which branch POST /api/files/upload takes, and it is the `kind` that decides.
//
// The two branches authorize differently, so taking the wrong one is not a cosmetic bug: an
// event image reaching `requireSpeaker()` is the gap this closed (an organizer has no speaker
// id, so Image Settings had a dropzone with nothing behind it), and a speaker upload reaching
// the organizer branch would ask for a role on an event instead of ownership of a record.
// Both directions are asserted here, along with the refusal a failing role check produces.
//
// The branch's own internals are in tests/settings-event-image-upload.test.ts; what this file
// cares about is that the route reaches them at all, and that it does not touch the speaker
// guard on the way.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'

const mocks = vi.hoisted(() => ({
  requireSpeaker: vi.fn(),
  uploadEventImage: vi.fn(),
  putObject: vi.fn(),
  createFileRecord: vi.fn(),
  resolveOwnSubmission: vi.fn(),
  saveSpeakerProfile: vi.fn(),
  getSpeaker: vi.fn(),
}))

vi.mock('@/features/auth/wiring', () => ({ requireSpeaker: mocks.requireSpeaker }))
vi.mock('@/features/portal/event-scope', () => ({ portalEventId: () => 'recEvt1' }))
vi.mock('@/features/portal/resolve-submission', () => ({
  resolveOwnSubmission: mocks.resolveOwnSubmission,
}))
vi.mock('@/features/settings/event-image-upload', () => ({
  uploadEventImage: mocks.uploadEventImage,
}))
vi.mock('@/services/airtable/mutations-speakers', () => ({
  saveSpeakerProfile: mocks.saveSpeakerProfile,
}))
vi.mock('@/services/airtable/mutations-portal', () => ({
  createFileRecord: mocks.createFileRecord,
}))
vi.mock('@/services/airtable/queries', () => ({ getSpeaker: mocks.getSpeaker }))
vi.mock('@/services/storage/uploads', () => ({
  putObject: mocks.putObject,
  publicUrlFor: (key: string) => `https://cdn.example/${key}`,
  visibilityFor: (kind: string) => (kind === 'headshot' ? 'public' : 'private'),
}))

const { POST } = await import('@/app/api/files/upload/route')

function upload(query: string, contentType = 'image/png'): Request {
  return new Request(`https://bodo.example/api/files/upload?${query}`, {
    method: 'POST',
    headers: { 'content-type': contentType, 'content-length': '2048' },
    body: 'pretend-image-bytes',
  })
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset()

  mocks.requireSpeaker.mockResolvedValue({ speakerId: 'recSpk1' })
  mocks.getSpeaker.mockResolvedValue({ email: 'ada@example.com' })
  mocks.putObject.mockResolvedValue({
    objectKey: 'headshot/recSpk1/n1-me.png',
    size: 2048,
    contentType: 'image/png',
    visibility: 'public',
  })
  mocks.createFileRecord.mockResolvedValue({ id: 'recFile1', speakerId: 'recSpk1' })
  mocks.uploadEventImage.mockResolvedValue({
    objectKey: 'event-logo/recEvt1/n1-logo.png',
    url: 'https://cdn.example/event-logo/recEvt1/n1-logo.png',
    field: 'logoUrl',
    size: 2048,
    contentType: 'image/png',
    visibility: 'public',
  })
})

describe('an event image', () => {
  it('goes to the organizer branch and never through the speaker guard', async () => {
    const response = await POST(upload('kind=event-logo&eventId=recEvt1&filename=logo.png'))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ field: 'logoUrl' })
    expect(mocks.requireSpeaker).not.toHaveBeenCalled()
    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.createFileRecord).not.toHaveBeenCalled()
  })

  it('hands the branch the declared type and size, and the event that was named', async () => {
    await POST(upload('kind=event-background&eventId=recEvt2&filename=bg.png', 'image/webp'))

    expect(mocks.uploadEventImage.mock.calls.at(0)?.[0]).toMatchObject({
      kind: 'event-background',
      eventId: 'recEvt2',
      filename: 'bg.png',
      contentType: 'image/webp',
      declaredBytes: 2048,
    })
  })

  it('answers a refused role as 401 rather than a 500', async () => {
    // The real AppError, because the route's handler recognises one with `instanceof` and
    // rethrows anything else as a 500. A duck-typed stand-in would be testing the wrong path.
    mocks.uploadEventImage.mockRejectedValue(
      new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'role admin is required'),
    )

    const response = await POST(upload('kind=event-logo&eventId=recOther&filename=logo.png'))

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ id: 'E_AUTH_005' })
  })

  it('is refused with no body, before either branch authorizes anything', async () => {
    const response = await POST(
      new Request('https://bodo.example/api/files/upload?kind=event-logo&eventId=recEvt1', {
        method: 'POST',
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.uploadEventImage).not.toHaveBeenCalled()
    expect(mocks.requireSpeaker).not.toHaveBeenCalled()
  })
})

describe('a speaker upload', () => {
  it('still takes the speaker branch', async () => {
    const response = await POST(upload('kind=headshot&filename=me.png'))

    expect(response.status).toBe(201)
    expect(mocks.requireSpeaker).toHaveBeenCalled()
    expect(mocks.uploadEventImage).not.toHaveBeenCalled()
  })

  it('refuses a kind that is neither, with the type-rejected status', async () => {
    const response = await POST(upload('kind=event-banner&eventId=recEvt1&filename=x.png'))

    expect(response.status).toBe(415)
    expect(mocks.uploadEventImage).not.toHaveBeenCalled()
    expect(mocks.putObject).not.toHaveBeenCalled()
  })
})

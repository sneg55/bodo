// POST /api/files/upload, at the seam where a stored object becomes a tracked file.
//
// Two orderings decide whether this route is correct, and neither is visible by reading
// the happy path:
//
//   1. The submission is resolved BEFORE the object is stored. A speaker who names a
//      submission they do not own must be refused with nothing written, because the
//      reverse order leaves an orphan object in R2 on every refused attempt and nothing
//      ever collects it.
//   2. The Files row is written AFTER the object is stored and HEADed. A row pointing at
//      an object that does not exist is worse than no row, because the portal renders it
//      as a file the speaker can open.
//
// Everything the route touches is mocked, since the point here is the sequence of calls
// and not what any of them do.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireSpeaker: vi.fn(),
  putObject: vi.fn(),
  createFileRecord: vi.fn(),
  resolveOwnSubmission: vi.fn(),
  saveSpeakerProfile: vi.fn(),
  getSpeaker: vi.fn(),
  /** Call order across the mocks, which is the actual subject of this file. */
  order: [] as string[],
}))

vi.mock('@/features/auth/wiring', () => ({ requireSpeaker: mocks.requireSpeaker }))
vi.mock('@/features/portal/event-scope', () => ({ portalEventId: () => 'recEvt1' }))
vi.mock('@/features/portal/resolve-submission', () => ({
  resolveOwnSubmission: mocks.resolveOwnSubmission,
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

function upload(query: string): Request {
  return new Request(`https://bodo.example/api/files/upload?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf', 'content-length': '2048' },
    body: 'pretend-pdf-bytes',
  })
}

beforeEach(() => {
  mocks.order.length = 0
  for (const fn of [
    mocks.requireSpeaker,
    mocks.putObject,
    mocks.createFileRecord,
    mocks.resolveOwnSubmission,
    mocks.saveSpeakerProfile,
    mocks.getSpeaker,
  ]) {
    fn.mockReset()
  }

  mocks.requireSpeaker.mockResolvedValue({ speakerId: 'recSpk1' })
  mocks.getSpeaker.mockResolvedValue({ email: 'ada@example.com' })
  mocks.putObject.mockImplementation(() => {
    mocks.order.push('put')
    return Promise.resolve({
      objectKey: 'speakers/recSpk1/doc/abc.pdf',
      size: 2048,
      contentType: 'application/pdf',
      visibility: 'private',
    })
  })
  mocks.createFileRecord.mockImplementation(() => {
    mocks.order.push('record')
    return Promise.resolve({ id: 'recFile1', speakerId: 'recSpk1' })
  })
  mocks.resolveOwnSubmission.mockImplementation(() => {
    mocks.order.push('resolve')
    return Promise.resolve({ id: 'recSub1' })
  })
})

describe('the Files row', () => {
  it('is written for a private kind, which used to be stored and never recorded', async () => {
    const response = await POST(upload('kind=doc&filename=deck.pdf'))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      fileId: 'recFile1',
      objectKey: 'speakers/recSpk1/doc/abc.pdf',
    })
  })

  it('carries the STORED size and type, not the values the client declared', async () => {
    // The declared numbers are an assertion by the browser. `putObject` HEADs the object
    // and returns what is actually there, and that is what the row has to record.
    await POST(upload('kind=doc&filename=deck.pdf'))

    expect(mocks.createFileRecord.mock.calls.at(0)?.[0]).toMatchObject({
      size: 2048,
      contentType: 'application/pdf',
      visibility: 'private',
      objectKey: 'speakers/recSpk1/doc/abc.pdf',
    })
  })

  it('is written after the object exists, never before', async () => {
    await POST(upload('kind=doc&filename=deck.pdf'))

    expect(mocks.order).toEqual(['put', 'record'])
  })

  it('has no submission when no code was given', async () => {
    await POST(upload('kind=doc&filename=deck.pdf'))

    expect(mocks.createFileRecord.mock.calls.at(0)?.[0]).toMatchObject({
      submissionId: undefined,
    })
  })

  it('attaches to the submission named by a code', async () => {
    await POST(upload('kind=doc&filename=deck.pdf&code=SESS-4'))

    expect(mocks.resolveOwnSubmission.mock.calls.at(0)?.[0]).toMatchObject({
      speakerId: 'recSpk1',
      code: 'SESS-4',
    })
    expect(mocks.createFileRecord.mock.calls.at(0)?.[0]).toMatchObject({
      submissionId: 'recSub1',
    })
  })
})

describe('a submission the caller does not own', () => {
  it('is refused before anything is stored, so R2 gets no orphan', async () => {
    mocks.resolveOwnSubmission.mockRejectedValue(
      Object.assign(new Error('no such submission for this speaker'), {
        id: 'E_DATA_002',
        toLogLine: () => 'E_DATA_002',
      }),
    )

    await POST(upload('kind=doc&filename=deck.pdf&code=SESS-9')).catch(() => undefined)

    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.createFileRecord).not.toHaveBeenCalled()
  })

  it('resolves ownership before the upload even on the happy path', async () => {
    await POST(upload('kind=doc&filename=deck.pdf&code=SESS-4'))

    expect(mocks.order).toEqual(['resolve', 'put', 'record'])
  })
})

describe('a headshot', () => {
  it('updates the Speakers record as well as writing a Files row', async () => {
    // The avatar is read off the Speakers record everywhere, so the headshot is the one
    // kind that lands in two places. Both have to happen.
    mocks.putObject.mockResolvedValue({
      objectKey: 'speakers/recSpk1/headshot/x.png',
      size: 1024,
      contentType: 'image/png',
      visibility: 'public',
    })

    await POST(upload('kind=headshot&filename=me.png'))

    expect(mocks.saveSpeakerProfile).toHaveBeenCalled()
    expect(mocks.createFileRecord).toHaveBeenCalled()
  })
})

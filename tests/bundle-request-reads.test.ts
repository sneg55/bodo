// The read behind EXPORT on the File Requests board, with the DAL mocked.
//
// The rules are tests/bundle-request-selection.test.ts. What is asserted here is the
// COMPOSITION, and the composition is the whole design: this read resolves requests to file
// ids and then delegates to `loadFileBundleCandidates`, so an archive exported from the File
// Requests board and the same files exported from PORTALS > Files come out identical. If the
// delegation ever gets replaced by a second candidate builder, the latest-version assertion
// below is what fails.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listFileRequests: vi.fn(),
  listFileRequestAssignmentsForEvent: vi.fn(),
  listSpeakers: vi.fn(),
  listSubmissions: vi.fn(),
  listFilesForEventSpeakers: vi.fn(),
}))

vi.mock('@/services/airtable/queries', () => ({
  listFileRequests: mocks.listFileRequests,
  listFileRequestAssignmentsForEvent: mocks.listFileRequestAssignmentsForEvent,
  listSpeakers: mocks.listSpeakers,
  listSubmissions: mocks.listSubmissions,
  listFilesForEventSpeakers: mocks.listFilesForEventSpeakers,
}))

const { loadRequestBundleCandidates } = await import('@/features/bundle/request-reads')

const ANA = 'rec-speaker-ana'

function delivered(
  over: { id: string; fileRequestAssignmentId: string } & Record<string, unknown>,
) {
  return {
    speakerId: ANA,
    kind: 'doc',
    objectKey: `doc/${ANA}/${over.id}-release.pdf`,
    filename: 'release.pdf',
    size: 100,
    visibility: 'private',
    contentType: 'application/pdf',
    uploadedAt: '2026-08-01T10:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listFileRequests.mockResolvedValue([
    { id: 'req-release', title: 'Signed release form' },
    { id: 'req-headshot', title: 'Headshot' },
  ])
  mocks.listFileRequestAssignmentsForEvent.mockResolvedValue([
    { assignment: { id: 'asg-1', fileRequestId: 'req-release' }, request: {} },
    { assignment: { id: 'asg-2', fileRequestId: 'req-headshot' }, request: {} },
  ])
  mocks.listSpeakers.mockResolvedValue([
    { id: ANA, firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com' },
  ])
  mocks.listSubmissions.mockResolvedValue([])
  mocks.listFilesForEventSpeakers.mockResolvedValue([])
})

describe('scope', () => {
  it('bounds the files read by the event roster', async () => {
    await loadRequestBundleCandidates({
      eventId: 'rec-event-1',
      checkedRequestIds: ['req-release'],
    })

    expect(mocks.listFilesForEventSpeakers).toHaveBeenCalledWith('rec-event-1', [ANA])
  })

  it('resolves nothing for a request id the event does not hold', async () => {
    mocks.listFilesForEventSpeakers.mockResolvedValue([
      delivered({ id: 'f-1', fileRequestAssignmentId: 'asg-1' }),
    ])

    const result = await loadRequestBundleCandidates({
      eventId: 'rec-event-1',
      checkedRequestIds: ['recFromAnotherConference'],
    })

    expect(result.files).toEqual([])
    expect(result.plan.foreign).toBe(1)
  })
})

describe('candidates', () => {
  it('carries the delivered file through to a candidate', async () => {
    mocks.listFilesForEventSpeakers.mockResolvedValue([
      delivered({ id: 'f-1', fileRequestAssignmentId: 'asg-1' }),
    ])

    const result = await loadRequestBundleCandidates({
      eventId: 'rec-event-1',
      checkedRequestIds: ['req-release'],
    })

    expect(result.files.map((file) => file.id)).toEqual(['f-1'])
    expect(result.files[0]?.speakerLabel).toBe('Ana Ruiz')
  })

  it('ships only the latest answer when a request was delivered twice', async () => {
    mocks.listFilesForEventSpeakers.mockResolvedValue([
      delivered({
        id: 'f-old',
        fileRequestAssignmentId: 'asg-1',
        uploadedAt: '2026-08-01T10:00:00.000Z',
      }),
      delivered({
        id: 'f-new',
        fileRequestAssignmentId: 'asg-1',
        filename: 'release-FINAL.pdf',
        uploadedAt: '2026-08-05T10:00:00.000Z',
      }),
    ])

    const result = await loadRequestBundleCandidates({
      eventId: 'rec-event-1',
      checkedRequestIds: ['req-release'],
    })

    expect(result.files.map((file) => file.id)).toEqual(['f-new'])
  })

  it('applies the dialog opt-outs', async () => {
    mocks.listFilesForEventSpeakers.mockResolvedValue([
      delivered({ id: 'f-1', fileRequestAssignmentId: 'asg-1' }),
    ])

    const result = await loadRequestBundleCandidates({
      eventId: 'rec-event-1',
      checkedRequestIds: ['req-release'],
      deselectedFileIds: ['f-1'],
    })

    expect(result.files).toEqual([])
  })
})

describe('the notice', () => {
  it('names an undelivered request beside the ones that did arrive', async () => {
    mocks.listFilesForEventSpeakers.mockResolvedValue([
      delivered({ id: 'f-1', fileRequestAssignmentId: 'asg-1' }),
    ])

    const result = await loadRequestBundleCandidates({
      eventId: 'rec-event-1',
      checkedRequestIds: ['req-release', 'req-headshot'],
    })

    expect(result.files.map((file) => file.id)).toEqual(['f-1'])
    expect(result.notice).toContain('Headshot')
  })

  it('still explains itself when the whole selection is undelivered', async () => {
    const result = await loadRequestBundleCandidates({
      eventId: 'rec-event-1',
      checkedRequestIds: ['req-release', 'req-headshot'],
    })

    expect(result.files).toEqual([])
    expect(result.notice).toContain('Signed release form, Headshot')
    // The whole point of the notice: an empty dialog with no explanation reads as a broken
    // export rather than as two documents nobody has sent yet.
    expect(result.plan.problem).toBeUndefined()
  })

  it('says nothing when every ticked request was delivered', async () => {
    mocks.listFilesForEventSpeakers.mockResolvedValue([
      delivered({ id: 'f-1', fileRequestAssignmentId: 'asg-1' }),
    ])

    const result = await loadRequestBundleCandidates({
      eventId: 'rec-event-1',
      checkedRequestIds: ['req-release'],
    })

    expect(result.notice).toBeUndefined()
  })
})

// The one read the EXPORT dialog and the streaming route share, with the DAL mocked.
//
// Sharing it is the point: a dialog that lists one set and a route that streams another is
// how a bundle silently gains or loses a file. What is asserted here is the COMPOSITION
// rather than the rules (those are tests/bundle-file-selection.test.ts): that event scope
// comes from the speaker roster and nothing else, that the roster is what bounds the files
// read, that a portal file with no session still resolves, that the version rule runs before
// the dialog's opt-outs, and that the archive paths that come out of the whole thing put one
// folder per session.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { bundleEntryPaths } from '@/features/bundle/grouping'

const mocks = vi.hoisted(() => ({
  listSubmissions: vi.fn(),
  listSpeakers: vi.fn(),
  listFilesForEventSpeakers: vi.fn(),
}))

vi.mock('@/services/airtable/queries', () => ({
  listSubmissions: mocks.listSubmissions,
  listSpeakers: mocks.listSpeakers,
  listFilesForEventSpeakers: mocks.listFilesForEventSpeakers,
}))

const { loadFileBundleCandidates } = await import('@/features/bundle/file-reads')

const ANA = 'rec-speaker-ana'
const BO = 'rec-speaker-bo'

function storedFile(over: { id: string } & Record<string, unknown>) {
  return {
    speakerId: ANA,
    submissionId: 'sub-1',
    kind: 'slides',
    objectKey: `slides/${ANA}/${over.id}-deck.pdf`,
    filename: 'deck.pdf',
    size: 100,
    visibility: 'private',
    contentType: 'application/pdf',
    uploadedAt: '2026-08-01T10:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listSubmissions.mockResolvedValue([
    { id: 'sub-1', code: 'SESS-1', title: 'Scaling Postgres', participants: [{ speakerId: ANA }] },
    { id: 'sub-2', code: 'SESS-2', title: 'Zero downtime', participants: [{ speakerId: BO }] },
  ])
  mocks.listSpeakers.mockResolvedValue([
    { id: ANA, firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com' },
    { id: BO, firstName: 'Bo', lastName: 'Chen', email: 'bo@example.com' },
  ])
  mocks.listFilesForEventSpeakers.mockResolvedValue([])
})

describe('event scope', () => {
  it('bounds the files read by the event roster and by nothing the caller passed', async () => {
    await loadFileBundleCandidates({ eventId: 'rec-event-1', checkedFileIds: ['f-1'] })

    expect(mocks.listFilesForEventSpeakers).toHaveBeenCalledWith('rec-event-1', [ANA, BO])
  })

  it('drops a file id the event does not hold, and counts it', async () => {
    mocks.listFilesForEventSpeakers.mockResolvedValue([storedFile({ id: 'f-1' })])

    const result = await loadFileBundleCandidates({
      eventId: 'rec-event-1',
      checkedFileIds: ['f-1', 'recFromAnotherConference'],
    })

    expect(result.files.map((file) => file.id)).toEqual(['f-1'])
    expect(result.scope.foreign).toBe(1)
  })

  it('reports an empty selection with no candidates rather than the whole event', async () => {
    mocks.listFilesForEventSpeakers.mockResolvedValue([storedFile({ id: 'f-1' })])

    const result = await loadFileBundleCandidates({
      eventId: 'rec-event-1',
      checkedFileIds: [],
    })

    expect(result.scope.problem).toBe('empty')
    expect(result.files).toEqual([])
  })

  it('hands back the roster the route checks object keys against', async () => {
    const result = await loadFileBundleCandidates({
      eventId: 'rec-event-1',
      checkedFileIds: ['f-1'],
    })

    expect([...result.speakerIds].toSorted()).toEqual([ANA, BO].toSorted())
  })
})

describe('candidates', () => {
  it('labels a session file with its code and title, and a portal file with neither', async () => {
    mocks.listFilesForEventSpeakers.mockResolvedValue([
      storedFile({ id: 'f-1' }),
      storedFile({
        id: 'f-2',
        submissionId: undefined,
        kind: 'headshot',
        filename: 'ana.jpg',
        objectKey: `headshot/${ANA}/f-2-ana.jpg`,
      }),
    ])

    const result = await loadFileBundleCandidates({
      eventId: 'rec-event-1',
      checkedFileIds: ['f-1', 'f-2'],
    })

    expect(result.files.map((file) => file.sessionLabel)).toEqual(['SESS-1 Scaling Postgres', ''])
    expect(result.files.map((file) => file.speakerLabel)).toEqual(['Ana Ruiz', 'Ana Ruiz'])
  })

  it('ships the latest version when a superseded row was ticked', async () => {
    mocks.listFilesForEventSpeakers.mockResolvedValue([
      storedFile({ id: 'f-old', uploadedAt: '2026-08-01T10:00:00.000Z' }),
      storedFile({ id: 'f-new', uploadedAt: '2026-08-05T10:00:00.000Z' }),
    ])

    const result = await loadFileBundleCandidates({
      eventId: 'rec-event-1',
      checkedFileIds: ['f-old', 'f-new'],
    })

    expect(result.files.map((file) => file.id)).toEqual(['f-new'])
  })

  it('applies the dialog opt-outs after the version rule, never before it', async () => {
    mocks.listFilesForEventSpeakers.mockResolvedValue([
      storedFile({ id: 'f-old', uploadedAt: '2026-08-01T10:00:00.000Z' }),
      storedFile({ id: 'f-new', uploadedAt: '2026-08-05T10:00:00.000Z' }),
    ])

    const result = await loadFileBundleCandidates({
      eventId: 'rec-event-1',
      checkedFileIds: ['f-old', 'f-new'],
      // The survivor. Unticking it must empty the group rather than promote its predecessor.
      deselectedFileIds: ['f-new'],
    })

    expect(result.files).toEqual([])
  })
})

describe('the archive layout the whole path produces', () => {
  it('puts one folder per session, and a portal file under Unassigned', async () => {
    mocks.listFilesForEventSpeakers.mockResolvedValue([
      storedFile({ id: 'f-1' }),
      storedFile({
        id: 'f-2',
        speakerId: BO,
        submissionId: 'sub-2',
        objectKey: `slides/${BO}/f-2-deck.pdf`,
      }),
      storedFile({
        id: 'f-3',
        submissionId: undefined,
        kind: 'headshot',
        filename: 'ana.jpg',
        objectKey: `headshot/${ANA}/f-3-ana.jpg`,
      }),
    ])

    const result = await loadFileBundleCandidates({
      eventId: 'rec-event-1',
      checkedFileIds: ['f-1', 'f-2', 'f-3'],
    })

    expect(bundleEntryPaths(result.files, 'session').map((entry) => entry.path)).toEqual([
      'SESS-1 Scaling Postgres/deck.pdf',
      'SESS-2 Zero downtime/deck.pdf',
      'Unassigned/ana.jpg',
    ])
  })
})

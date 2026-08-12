// The one read both the modal and the download share, with the DAL mocked.
//
// Sharing it is the point: a modal that lists one set and a route that streams another is how
// a bundle silently gains or loses a file. So what is asserted here is the composition rather
// than the rules (those are tests/bundle-selection.test.ts): that event scope comes from
// `listSubmissions` and nothing else, that the latest-version rule is applied per session, that
// the modal's opt-outs are applied AFTER it, and that `speakerIds` is the union of the two
// event-scoped sources the download's key check depends on.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listSubmissions: vi.fn(),
  listSpeakers: vi.fn(),
  listFilesForSubmission: vi.fn(),
}))

vi.mock('@/services/airtable/queries', () => ({
  listSubmissions: mocks.listSubmissions,
  listSpeakers: mocks.listSpeakers,
  listFilesForSubmission: mocks.listFilesForSubmission,
}))

const { loadBundleCandidates } = await import('@/features/bundle/reads')

const ANA = 'rec-speaker-ana'
const BO = 'rec-speaker-bo'

function submission(id: string, code: string, title: string, speakerIds: readonly string[]) {
  return {
    id,
    code,
    title,
    participants: speakerIds.map((speakerId) => ({ speakerId })),
  }
}

function storedFile(over: { id: string; submissionId: string } & Record<string, unknown>) {
  return {
    speakerId: ANA,
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
    submission('sub-1', 'SESS-1', 'Scaling Postgres', [ANA]),
    submission('sub-2', 'SESS-2', 'Zero downtime', [BO]),
  ])
  mocks.listSpeakers.mockResolvedValue([
    { id: ANA, firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com' },
    { id: BO, firstName: 'Bo', lastName: 'Chen', email: 'bo@example.com' },
  ])
  mocks.listFilesForSubmission.mockResolvedValue([])
})

describe('loadBundleCandidates scope', () => {
  it('reads files only for the checked sessions', async () => {
    await loadBundleCandidates({ eventId: 'rec-event-1', checkedSessionIds: ['sub-2'] })

    expect(mocks.listFilesForSubmission).toHaveBeenCalledTimes(1)
    expect(mocks.listFilesForSubmission).toHaveBeenCalledWith('sub-2')
  })

  it('never reads a session the event does not contain', async () => {
    const result = await loadBundleCandidates({
      eventId: 'rec-event-1',
      checkedSessionIds: ['sub-1', 'sub-from-another-conference'],
    })

    expect(mocks.listFilesForSubmission).toHaveBeenCalledExactlyOnceWith('sub-1')
    expect(result.scope.foreign).toBe(1)
  })

  it('reads no files at all for an empty selection', async () => {
    const result = await loadBundleCandidates({ eventId: 'rec-event-1', checkedSessionIds: [] })

    expect(mocks.listFilesForSubmission).not.toHaveBeenCalled()
    expect(result.scope.problem).toBe('empty')
    expect(result.files).toEqual([])
  })

  it('still reports the speaker roster when the scope refuses, since the caller carries it', async () => {
    const result = await loadBundleCandidates({ eventId: 'rec-event-1', checkedSessionIds: [] })

    expect(result.speakerIds).toEqual([ANA, BO])
  })
})

describe('loadBundleCandidates projection', () => {
  beforeEach(() => {
    mocks.listFilesForSubmission.mockImplementation((sessionId: string) =>
      Promise.resolve([
        storedFile({ id: `f-${sessionId}-old`, submissionId: sessionId }),
        storedFile({
          id: `f-${sessionId}-new`,
          submissionId: sessionId,
          uploadedAt: '2026-08-06T10:00:00.000Z',
        }),
      ]),
    )
  })

  it('keeps only the latest version of each file, per session', async () => {
    const result = await loadBundleCandidates({
      eventId: 'rec-event-1',
      checkedSessionIds: ['sub-1', 'sub-2'],
    })

    expect(result.files.map((file) => file.id)).toEqual(['f-sub-1-new', 'f-sub-2-new'])
  })

  it('labels each file with its session code and title, and its speaker name', async () => {
    const result = await loadBundleCandidates({
      eventId: 'rec-event-1',
      checkedSessionIds: ['sub-1'],
    })

    expect(result.files.at(0)?.sessionLabel).toBe('SESS-1 Scaling Postgres')
    expect(result.files.at(0)?.speakerLabel).toBe('Ana Ruiz')
  })

  it('falls back to the email when a speaker has no name', async () => {
    mocks.listSpeakers.mockResolvedValue([
      { id: ANA, firstName: '', lastName: '  ', email: 'ana@example.com' },
    ])

    const result = await loadBundleCandidates({
      eventId: 'rec-event-1',
      checkedSessionIds: ['sub-1'],
    })

    expect(result.files.at(0)?.speakerLabel).toBe('ana@example.com')
  })

  it('applies the modal opt-outs after the version rule, not before it', async () => {
    const result = await loadBundleCandidates({
      eventId: 'rec-event-1',
      checkedSessionIds: ['sub-1'],
      // The OLD version. Unticking something the modal never showed must not promote it back.
      deselectedFileIds: ['f-sub-1-old'],
    })

    expect(result.files.map((file) => file.id)).toEqual(['f-sub-1-new'])
  })

  it('drops a file the organizer unticked', async () => {
    const result = await loadBundleCandidates({
      eventId: 'rec-event-1',
      checkedSessionIds: ['sub-1'],
      deselectedFileIds: ['f-sub-1-new'],
    })

    expect(result.files).toEqual([])
  })

  it('counts the sessions in scope, which the email reports', async () => {
    const result = await loadBundleCandidates({
      eventId: 'rec-event-1',
      checkedSessionIds: ['sub-1', 'sub-2'],
    })

    expect(result.sessionCount).toBe(2)
  })
})

describe('loadBundleCandidates speaker scope', () => {
  it('includes a cast speaker whose Speakers row has lost its event link', async () => {
    mocks.listSpeakers.mockResolvedValue([
      { id: ANA, firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com' },
    ])

    const result = await loadBundleCandidates({
      eventId: 'rec-event-1',
      checkedSessionIds: ['sub-1'],
    })

    // Without the union, the download would refuse a file this event plainly owns.
    expect(result.speakerIds).toContain(BO)
  })

  it('does not repeat a speaker who is both on the roster and in a cast', async () => {
    const result = await loadBundleCandidates({
      eventId: 'rec-event-1',
      checkedSessionIds: ['sub-1'],
    })

    expect(result.speakerIds).toEqual([ANA, BO])
  })
})

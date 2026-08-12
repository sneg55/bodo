// GET /api/files/bundle/selection: that it authorizes ITSELF, and in what order.
//
// The URL the EXPORT dialog navigates to is not a capability, so everything depends on this
// handler asking `requireEventRole` on the request's own session before it reads anything. A
// layout is not a security boundary (bodo-conventions, "Routes"), and this route has no
// layout at all.
//
// The archive's own behaviour is tests/bundle-archive.test.ts and the selection rules are
// tests/bundle-file-selection.test.ts. What is asserted here is the wiring: the guard runs
// first, the ids and the grouping reach the read from the URL, the response carries the
// headers that make a private zip download correctly, and a refusal maps to a status rather
// than escaping as a 500.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'

const mocks = vi.hoisted(() => ({
  requireEventRole: vi.fn(),
  loadFileBundleCandidates: vi.fn(),
  buildBundleArchive: vi.fn(),
}))

vi.mock('@/features/auth/wiring', () => ({ requireEventRole: mocks.requireEventRole }))
vi.mock('@/features/bundle/file-reads', () => ({
  loadFileBundleCandidates: mocks.loadFileBundleCandidates,
}))
vi.mock('@/features/bundle/archive', () => ({ buildBundleArchive: mocks.buildBundleArchive }))

const { GET } = await import('@/app/api/files/bundle/selection/route')

const QUERY = 'eventId=rec-event-1&files=f-1,f-2&group=speaker'

function get(query = QUERY): Request {
  return new Request(`https://bodo.example/api/files/bundle/selection?${query}`)
}

function emptyArchive() {
  return {
    filename: 'files-2026-08-10.zip',
    totalBytes: 22,
    fileCount: 2,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireEventRole.mockResolvedValue({ userId: 'usr-1', role: 'reviewer' })
  mocks.loadFileBundleCandidates.mockResolvedValue({
    scope: { fileIds: ['f-1', 'f-2'], foreign: 0 },
    files: [],
    speakerIds: ['rec-speaker-ana'],
  })
  mocks.buildBundleArchive.mockResolvedValue(emptyArchive())
})

describe('authorization', () => {
  it('asks for a role on the event named by the URL', async () => {
    await GET(get())

    expect(mocks.requireEventRole).toHaveBeenCalledWith('rec-event-1', 'reviewer')
  })

  it('reads nothing when the role check refuses, and answers 401', async () => {
    mocks.requireEventRole.mockRejectedValue(
      new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'role reviewer is required'),
    )

    const response = await GET(get())

    expect(response.status).toBe(401)
    expect(mocks.loadFileBundleCandidates).not.toHaveBeenCalled()
    expect(mocks.buildBundleArchive).not.toHaveBeenCalled()
  })

  it('refuses a URL with no event id instead of treating it as unscoped', async () => {
    mocks.requireEventRole.mockRejectedValue(
      new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'role reviewer is required'),
    )

    const response = await GET(get('files=f-1'))

    expect(response.status).toBe(401)
    expect(mocks.requireEventRole).toHaveBeenCalledWith('', 'reviewer')
  })
})

describe('wiring', () => {
  it('passes the URL selection to the read and the roster to the archive', async () => {
    await GET(get())

    expect(mocks.loadFileBundleCandidates).toHaveBeenCalledWith({
      eventId: 'rec-event-1',
      checkedFileIds: ['f-1', 'f-2'],
    })
    expect(mocks.buildBundleArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'rec-event-1',
        grouping: 'speaker',
        allowedSpeakerIds: ['rec-speaker-ana'],
        filenamePrefix: 'files',
      }),
    )
  })

  it('sends the headers that make a private archive download rather than render', async () => {
    const response = await GET(get())

    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-length')).toBe('22')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="files-2026-08-10.zip"',
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})

describe('refusals', () => {
  it('answers 404 when nothing in the selection is on the event any more', async () => {
    mocks.loadFileBundleCandidates.mockResolvedValue({
      scope: { fileIds: [], foreign: 2, problem: 'empty' },
      files: [],
      speakerIds: [],
    })

    const response = await GET(get())

    expect(response.status).toBe(404)
    expect(mocks.buildBundleArchive).not.toHaveBeenCalled()
  })

  it('answers 413 for a selection past the cap', async () => {
    mocks.loadFileBundleCandidates.mockResolvedValue({
      scope: { fileIds: [], foreign: 0, problem: 'too-many' },
      files: [],
      speakerIds: [],
    })

    expect((await GET(get())).status).toBe(413)
  })

  it('maps a scope failure raised inside the archive to 401 rather than a 500', async () => {
    mocks.buildBundleArchive.mockRejectedValue(
      new AppError(
        ErrorIds.AUTH_FORBIDDEN_ROLE,
        'the download includes files this event does not own',
      ),
    )

    expect((await GET(get())).status).toBe(401)
  })
})

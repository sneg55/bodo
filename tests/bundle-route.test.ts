// GET /api/files/bundle: that it authorizes ITSELF, and in what order.
//
// The emailed link is not a capability, so everything depends on this handler asking
// `requireEventRole` on the request's own session before it reads anything. A layout is not a
// security boundary (bodo-conventions, "Routes"), and this route has no layout at all.
//
// The archive's own behaviour is tests/bundle-archive.test.ts. What is asserted here is the
// wiring: the guard runs first, the event id and grouping reach the reads from the URL, the
// response carries the headers that make a private zip download correctly, and a refusal maps
// to a status rather than escaping as a 500.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'

const mocks = vi.hoisted(() => ({
  requireEventRole: vi.fn(),
  loadBundleCandidates: vi.fn(),
  buildBundleArchive: vi.fn(),
}))

vi.mock('@/features/auth/wiring', () => ({ requireEventRole: mocks.requireEventRole }))
vi.mock('@/features/bundle/reads', () => ({ loadBundleCandidates: mocks.loadBundleCandidates }))
vi.mock('@/features/bundle/archive', () => ({ buildBundleArchive: mocks.buildBundleArchive }))

const { GET } = await import('@/app/api/files/bundle/route')

const QUERY = 'eventId=rec-event-1&sessions=sub-1,sub-2&group=speaker&omit=f-3'

function get(query = QUERY): Request {
  return new Request(`https://bodo.example/api/files/bundle?${query}`)
}

function emptyArchive() {
  return {
    filename: 'abstracts-files-2026-08-09.zip',
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
  mocks.loadBundleCandidates.mockResolvedValue({
    scope: { sessionIds: ['sub-1', 'sub-2'], foreign: 0 },
    files: [],
    speakerIds: ['rec-speaker-ana'],
    sessionCount: 2,
  })
  mocks.buildBundleArchive.mockResolvedValue(emptyArchive())
})

describe('GET /api/files/bundle authorization', () => {
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
    expect(mocks.loadBundleCandidates).not.toHaveBeenCalled()
    expect(mocks.buildBundleArchive).not.toHaveBeenCalled()
  })

  it('refuses a URL with no event id instead of treating it as unscoped', async () => {
    mocks.requireEventRole.mockRejectedValue(
      new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'role reviewer is required'),
    )

    expect((await GET(get('sessions=sub-1'))).status).toBe(401)
    expect(mocks.requireEventRole).toHaveBeenCalledWith('', 'reviewer')
  })

  it('answers 401 for no session at all', async () => {
    mocks.requireEventRole.mockRejectedValue(
      new AppError(ErrorIds.AUTH_NO_SESSION, 'no session cookie on this request'),
    )

    expect((await GET(get())).status).toBe(401)
  })
})

describe('GET /api/files/bundle wiring', () => {
  it('passes the selection and the opt-outs from the URL to the read', async () => {
    await GET(get())

    expect(mocks.loadBundleCandidates).toHaveBeenCalledWith({
      eventId: 'rec-event-1',
      checkedSessionIds: ['sub-1', 'sub-2'],
      deselectedFileIds: ['f-3'],
    })
  })

  it('hands the archive the roster the read returned, not anything from the URL', async () => {
    await GET(get())
    const input = mocks.buildBundleArchive.mock.calls.at(0)?.at(0) as
      | { allowedSpeakerIds: readonly string[]; grouping: string }
      | undefined

    expect(input?.allowedSpeakerIds).toEqual(['rec-speaker-ana'])
    expect(input?.grouping).toBe('speaker')
  })
})

describe('GET /api/files/bundle response', () => {
  it('is a zip attachment with an exact length and no shared caching', async () => {
    const response = await GET(get())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-length')).toBe('22')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="abstracts-files-2026-08-09.zip"',
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('maps a missing record to 404 rather than a bare 500', async () => {
    mocks.buildBundleArchive.mockRejectedValue(
      new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'the selected sessions have no files'),
    )

    expect((await GET(get())).status).toBe(404)
  })

  it('maps an out-of-scope object key to 401, since that is a refusal not a fault', async () => {
    mocks.buildBundleArchive.mockRejectedValue(
      new AppError(
        ErrorIds.AUTH_FORBIDDEN_ROLE,
        'the download includes files this event does not own',
      ),
    )

    expect((await GET(get())).status).toBe(401)
  })

  it('maps a missing binding to 503', async () => {
    mocks.buildBundleArchive.mockRejectedValue(
      new AppError(ErrorIds.CFG_BINDING_MISSING, 'BODO_UPLOADS is not bound'),
    )

    expect((await GET(get())).status).toBe(503)
  })

  it('maps an archive too large for a 32-bit zip to 413', async () => {
    mocks.buildBundleArchive.mockRejectedValue(
      new AppError(ErrorIds.FILE_TOO_LARGE, 'the archive is larger than a 32-bit zip can address'),
    )

    expect((await GET(get())).status).toBe(413)
  })
})

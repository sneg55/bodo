// What the portal renders for one speaker's requested documents.

import { describe, expect, it } from 'vitest'

import { outstandingRequests, toRequestUploadViews } from '@/features/file-requests/portal-view'

import { fileRequest, requestItem, storedFile, submission } from './helpers/portal-fakes'

const TZ = 'America/Los_Angeles'

const release = fileRequest({
  id: 'recReqRelease',
  entityType: 'contact',
  title: 'Signed speaker release',
  instructionsHtml: '<p>Upload the signed PDF.</p>',
  required: true,
})
const slides = fileRequest({
  id: 'recReqSlides',
  entityType: 'submission',
  title: 'Slides',
  required: false,
  dueAt: '2026-10-01T00:00:00.000Z',
})

const own = submission({ id: 'recSub1', code: 'SESS-1', title: 'Evaluating agents' })

describe('toRequestUploadViews', () => {
  it('carries the instructions HTML through untouched, for the portal to render', () => {
    const views = toRequestUploadViews({
      items: [requestItem({ request: release, assignment: { id: 'recA1' } })],
      submissions: [own],
      files: [],
      timeZone: TZ,
    })

    expect(views[0]?.instructionsHtml).toBe('<p>Upload the signed PDF.</p>')
    expect(views[0]?.required).toBe(true)
    expect(views[0]?.received).toBe(false)
  })

  it('labels a submission-scoped request with the session it belongs to', () => {
    const views = toRequestUploadViews({
      items: [
        requestItem({ request: slides, assignment: { id: 'recA3', submissionId: 'recSub1' } }),
      ],
      submissions: [own],
      files: [],
      timeZone: TZ,
    })

    expect(views[0]?.submissionCode).toBe('SESS-1')
    expect(views[0]?.submissionLabel).toContain('SESS-1')
    expect(views[0]?.dueLabel).toBe('Due Sep 30, 2026')
  })

  it('leaves the session label absent for a contact request', () => {
    const views = toRequestUploadViews({
      items: [requestItem({ request: release, assignment: { id: 'recA1' } })],
      submissions: [own],
      files: [],
      timeZone: TZ,
    })

    expect(views[0]?.submissionCode).toBeUndefined()
  })

  it('names the delivered file on a received request', () => {
    const views = toRequestUploadViews({
      items: [
        requestItem({
          request: release,
          assignment: { id: 'recA1', status: 'received', receivedAt: '2026-08-01T00:00:00.000Z' },
        }),
      ],
      submissions: [own],
      files: [
        storedFile({
          id: 'recFile1',
          fileRequestAssignmentId: 'recA1',
          filename: 'release.pdf',
          uploadedAt: '2026-08-01T00:00:00.000Z',
        }),
      ],
      timeZone: TZ,
    })

    expect(views[0]?.received).toBe(true)
    expect(views[0]?.deliveredFilename).toBe('release.pdf')
  })

  it('shows the newest file when one request was uploaded against twice', () => {
    const views = toRequestUploadViews({
      items: [requestItem({ request: release, assignment: { id: 'recA1', status: 'received' } })],
      submissions: [own],
      files: [
        storedFile({
          id: 'recFile1',
          fileRequestAssignmentId: 'recA1',
          filename: 'first.pdf',
          uploadedAt: '2026-08-01T00:00:00.000Z',
        }),
        storedFile({
          id: 'recFile2',
          fileRequestAssignmentId: 'recA1',
          filename: 'corrected.pdf',
          uploadedAt: '2026-08-02T00:00:00.000Z',
        }),
      ],
      timeZone: TZ,
    })

    expect(views[0]?.deliveredFilename).toBe('corrected.pdf')
  })

  it('lists EVERY delivered version, newest first, each with a time and a link', () => {
    // The count was not a history. `deliveredVersion` said "2 of 2" and named one file, so a
    // speaker who had re-uploaded could see that a second version existed and could not see
    // what it was, when it arrived, or open either one. The admin Files table has shown all
    // of that since versions shipped; this is the speaker's half of it.
    const views = toRequestUploadViews({
      items: [requestItem({ request: release, assignment: { id: 'recA1', status: 'received' } })],
      submissions: [own],
      files: [
        storedFile({
          id: 'recFile1',
          fileRequestAssignmentId: 'recA1',
          filename: 'first.pdf',
          uploadedAt: '2026-08-09T16:00:00.000Z',
        }),
        storedFile({
          id: 'recFile2',
          fileRequestAssignmentId: 'recA1',
          filename: 'corrected.pdf',
          uploadedAt: '2026-08-09T22:30:00.000Z',
        }),
      ],
      timeZone: TZ,
    })

    const versions = views[0]?.deliveredVersions ?? []
    expect(versions.map((entry) => [entry.filename, entry.version, entry.isLatest])).toEqual([
      ['corrected.pdf', 2, true],
      ['first.pdf', 1, false],
    ])
    expect(versions.map((entry) => entry.href)).toEqual([
      '/api/portal/files/recFile2',
      '/api/portal/files/recFile1',
    ])
    // Same calendar day in the event's zone, distinguishable only by the time. Both read
    // `Aug 9, 2026` before, which is exactly why the date alone was not enough.
    expect(versions[0].uploadedText).toBe('Aug 9, 2026, 3:30 PM')
    expect(versions[1].uploadedText).toBe('Aug 9, 2026, 9:00 AM')
  })

  it('gives a single delivery a row too, because that row is the only way to open it', () => {
    // Unlike the `(version 1 of 1)` sentence, which is noise, a row carrying a timestamp and
    // a download control says something the card had no other way to say.
    const views = toRequestUploadViews({
      items: [requestItem({ request: release, assignment: { id: 'recA1', status: 'received' } })],
      submissions: [own],
      files: [
        storedFile({ id: 'recFile1', fileRequestAssignmentId: 'recA1', filename: 'release.pdf' }),
      ],
      timeZone: TZ,
    })

    expect(views[0]?.deliveredVersion).toBeUndefined()
    expect(views[0]?.deliveredVersions).toHaveLength(1)
    expect(views[0]?.deliveredVersions[0]?.isLatest).toBe(true)
  })

  it('leaves the version list empty when nothing has been delivered', () => {
    const views = toRequestUploadViews({
      items: [requestItem({ request: release, assignment: { id: 'recA1' } })],
      submissions: [own],
      files: [],
      timeZone: TZ,
    })

    expect(views[0]?.deliveredVersions).toEqual([])
  })

  it('ignores a file that belongs to no file request', () => {
    const views = toRequestUploadViews({
      items: [requestItem({ request: release, assignment: { id: 'recA1' } })],
      submissions: [own],
      files: [storedFile({ id: 'recFile1', filename: 'headshot.png' })],
      timeZone: TZ,
    })

    expect(views[0]?.deliveredFilename).toBeUndefined()
  })
})

describe('outstandingRequests', () => {
  it('keeps only what has not arrived', () => {
    const views = toRequestUploadViews({
      items: [
        requestItem({ request: release, assignment: { id: 'recA1', status: 'received' } }),
        requestItem({
          request: slides,
          assignment: { id: 'recA3', submissionId: 'recSub1' },
        }),
      ],
      submissions: [own],
      files: [],
      timeZone: TZ,
    })

    expect(outstandingRequests(views).map((view) => view.assignmentId)).toEqual(['recA3'])
  })
})

// What a COMPLETED upload task tells the speaker about the file it received.
//
// It used to tell them nothing. The row rendered one sentence, "This task is already complete.",
// with no filename, no size and no way to open what had been sent. The 2026-08-12 eval run
// recorded a speaker uploading a headshot successfully and then finding it nowhere in the
// portal: not on the task, not on the session, not as their profile picture. A successful
// upload that leaves no trace is indistinguishable from one that failed.

import { describe, expect, it } from 'vitest'

import { toTaskViews } from '@/features/portal/task-view'
import type { StoredFile } from '@/types/domain'

const ZONE = 'America/Los_Angeles'

const FILE = {
  id: 'recFile1',
  speakerId: 'recSp1',
  kind: 'image',
  objectKey: 'image/recSp1/abc-headshot.png',
  visibility: 'private',
  contentType: 'image/png',
  filename: 'headshot.png',
  size: 2048,
  uploadedAt: '2026-08-12T09:00:00.000Z',
} as unknown as StoredFile

function uploadTask(status: 'pending' | 'done', answers?: Record<string, unknown>) {
  return {
    task: {
      id: 'recTask1',
      eventId: 'recEvent1',
      title: 'Upload your headshot',
      kind: 'upload',
      entityType: 'contact',
      origin: 'automated',
    },
    assignment: { id: 'recAsg1', taskId: 'recTask1', speakerId: 'recSp1', status, answers },
  } as unknown as Parameters<typeof toTaskViews>[0]['items'][number]
}

const base = { submissions: [], forms: [], timeZone: ZONE, files: [FILE] }

describe('a completed upload task', () => {
  it('names the file it received, with its size and a way to open it', () => {
    const [view] = toTaskViews({ ...base, items: [uploadTask('done', { fileId: 'recFile1' })] })

    expect(view.completedFile?.filename).toBe('headshot.png')
    expect(view.completedFile?.sizeLabel).toBe('2 KB')
    expect(view.completedFile?.href).toBe('/api/portal/files/recFile1')
  })

  it('links through the authenticated route, never the bucket', () => {
    // An answered upload is private (`visibilityFor`), so the link has to be the route that
    // re-derives ownership from the session rather than a public object URL.
    const [view] = toTaskViews({ ...base, items: [uploadTask('done', { fileId: 'recFile1' })] })

    expect(view.completedFile?.href?.startsWith('/api/portal/files/')).toBe(true)
  })

  it('resolves a completion that stored the R2 object key instead of the record id', () => {
    // `TaskCompletion` used to keep the upload route's `objectKey` in state and post THAT as
    // `fileId`. Rows completed before it was corrected are still in the base carrying, for
    // example, "doc/recSp1/804a7ca7-...-slides.pdf". The 2026-08-12 eval run found one: the
    // headshot task named its file and the slides task next to it did not.
    const [view] = toTaskViews({
      ...base,
      items: [uploadTask('done', { fileId: 'image/recSp1/abc-headshot.png' })],
    })

    expect(view.completedFile?.filename).toBe('headshot.png')
    // Still linked by RECORD id, whichever way it was found.
    expect(view.completedFile?.href).toBe('/api/portal/files/recFile1')
  })

  it('says nothing while the task is still pending', () => {
    const [view] = toTaskViews({ ...base, items: [uploadTask('pending', { fileId: 'recFile1' })] })

    expect(view.completedFile).toBeUndefined()
  })

  it('says nothing when the stored id no longer resolves', () => {
    // A row whose file was deleted in Airtable loses the line rather than rendering a dead
    // link, which is the call `SubmissionFiles` already makes for the same reason.
    const [view] = toTaskViews({ ...base, items: [uploadTask('done', { fileId: 'recGone' })] })

    expect(view.completedFile).toBeUndefined()
  })

  it('says nothing when the completion stored no file at all', () => {
    const [view] = toTaskViews({ ...base, items: [uploadTask('done', {})] })

    expect(view.completedFile).toBeUndefined()
  })

  it('is absent for a caller that passed no file list', () => {
    const [view] = toTaskViews({
      items: [uploadTask('done', { fileId: 'recFile1' })],
      submissions: [],
      forms: [],
      timeZone: ZONE,
    })

    expect(view.completedFile).toBeUndefined()
  })
})

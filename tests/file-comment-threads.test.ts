// A thread belongs to the deliverable, not to the upload.
//
// The regression these pin was measured on the running app: a comment on a file request
// vanished from the speaker's portal the moment a second version was uploaded, because the
// thread was read back by file id and version 2 is a different `Files` row.

import { describe, expect, it } from 'vitest'

import { fileCommentThreads } from '@/features/files/comment-threads'
import type { StoredFile } from '@/types/domain'

const file = (overrides: Partial<StoredFile> & { id: string }): StoredFile => ({
  speakerId: 'spk1',
  kind: 'doc',
  objectKey: `key/${overrides.id}`,
  visibility: 'private',
  contentType: 'application/pdf',
  filename: 'deck.pdf',
  size: 1000,
  uploadedAt: '2026-08-01T09:00:00.000Z',
  ...overrides,
})

const comment = (id: string, fileId: string, at: string) => ({ id, fileId, at, body: id })

describe('fileCommentThreads', () => {
  it('keeps a comment on a request visible after a new version is uploaded', () => {
    const v1 = file({ id: 'f1', fileRequestAssignmentId: 'asg1' })
    const v2 = file({
      id: 'f2',
      fileRequestAssignmentId: 'asg1',
      uploadedAt: '2026-08-02T09:00:00.000Z',
    })
    const threads = fileCommentThreads([v1, v2], [comment('c1', 'f1', '2026-08-01T10:00:00.000Z')])

    // The whole defect: read from the NEW file, the note posted on the old one is still there.
    expect(threads.get('f2')?.map((entry) => entry.id)).toEqual(['c1'])
    expect(threads.get('f1')?.map((entry) => entry.id)).toEqual(['c1'])
  })

  it('merges both sides of a conversation held across two versions, oldest first', () => {
    const v1 = file({ id: 'f1', fileRequestAssignmentId: 'asg1' })
    const v2 = file({
      id: 'f2',
      fileRequestAssignmentId: 'asg1',
      uploadedAt: '2026-08-02T09:00:00.000Z',
    })
    const threads = fileCommentThreads(
      [v1, v2],
      [
        comment('reply', 'f2', '2026-08-02T11:00:00.000Z'),
        comment('ask', 'f1', '2026-08-01T10:00:00.000Z'),
      ],
    )

    expect(threads.get('f2')?.map((entry) => entry.id)).toEqual(['ask', 'reply'])
  })

  it('records which version each comment was posted against', () => {
    const v1 = file({ id: 'f1', fileRequestAssignmentId: 'asg1' })
    const v2 = file({
      id: 'f2',
      fileRequestAssignmentId: 'asg1',
      uploadedAt: '2026-08-02T09:00:00.000Z',
    })
    const threads = fileCommentThreads(
      [v1, v2],
      [
        comment('c1', 'f1', '2026-08-01T10:00:00.000Z'),
        comment('c2', 'f2', '2026-08-03T10:00:00.000Z'),
      ],
    )

    expect(threads.get('f1')?.map((entry) => entry.onVersion)).toEqual([1, 2])
  })

  it('does not merge threads across different deliverables', () => {
    const deck = file({ id: 'f1', fileRequestAssignmentId: 'asg1' })
    const bio = file({ id: 'f2', fileRequestAssignmentId: 'asg2' })
    const threads = fileCommentThreads(
      [deck, bio],
      [comment('c1', 'f1', '2026-08-01T10:00:00.000Z')],
    )

    expect(threads.get('f2')).toEqual([])
  })

  it('groups free uploads the way the version history does', () => {
    // No request, so the group is speaker + session + kind, and a renamed re-upload is still
    // the same deliverable.
    const first = file({ id: 'f1', submissionId: 'sub1', kind: 'slides' })
    const second = file({
      id: 'f2',
      submissionId: 'sub1',
      kind: 'slides',
      filename: 'deck-final.pdf',
      uploadedAt: '2026-08-02T09:00:00.000Z',
    })
    const threads = fileCommentThreads(
      [first, second],
      [comment('c1', 'f1', '2026-08-01T10:00:00.000Z')],
    )

    expect(threads.get('f2')?.map((entry) => entry.id)).toEqual(['c1'])
  })

  it('drops a comment on a file outside the set it was given', () => {
    // The set is already scoped to one event or one speaker, so a stray file id is something
    // this reader may not see. It must not be attached to some other thread.
    const threads = fileCommentThreads(
      [file({ id: 'f1', fileRequestAssignmentId: 'asg1' })],
      [comment('c1', 'other', '2026-08-01T10:00:00.000Z')],
    )

    expect(threads.get('f1')).toEqual([])
  })

  it('returns an empty thread for a file nobody has commented on', () => {
    const threads = fileCommentThreads([file({ id: 'f1' })], [])
    expect(threads.get('f1')).toEqual([])
  })
})

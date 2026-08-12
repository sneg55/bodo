// Which upload supersedes which.
//
// Re-uploading has always created a new row and never deleted the old one, so the history
// was in the base and nothing said so: every row rendered identically and two uploads of a
// corrected deck looked like two unrelated files. These pin the grouping rules, which are
// the whole of the feature.

import { describe, expect, it } from 'vitest'

import { fileVersions, versionGroupKey } from '@/features/files/versions'
import type { StoredFile } from '@/types/domain'

const file = (overrides: Partial<StoredFile> & { id: string }): StoredFile => ({
  speakerId: 'spk1',
  kind: 'slides',
  objectKey: `key/${overrides.id}`,
  visibility: 'private',
  contentType: 'application/pdf',
  filename: 'deck.pdf',
  size: 1000,
  uploadedAt: '2026-08-01T09:00:00.000Z',
  ...overrides,
})

describe('versionGroupKey', () => {
  it('groups everything delivered against one file request', () => {
    // An assignment is one organizer asking one speaker for one document, so it wins over
    // every other signal however the speaker named the file.
    const first = file({ id: 'a', fileRequestAssignmentId: 'asg1', filename: 'deck.pdf' })
    const second = file({ id: 'b', fileRequestAssignmentId: 'asg1', filename: 'deck-FINAL.pdf' })

    expect(versionGroupKey(first)).toBe(versionGroupKey(second))
  })

  it('groups a free upload by speaker, session and kind rather than by filename', () => {
    // The case the old flat list got wrong: a renamed re-upload is still a re-upload.
    const first = file({ id: 'a', submissionId: 'sub1', filename: 'deck.pdf' })
    const second = file({ id: 'b', submissionId: 'sub1', filename: 'deck-v2.pdf' })

    expect(versionGroupKey(first)).toBe(versionGroupKey(second))
  })

  it('keeps slides for different sessions apart', () => {
    expect(versionGroupKey(file({ id: 'a', submissionId: 'sub1' }))).not.toBe(
      versionGroupKey(file({ id: 'b', submissionId: 'sub2' })),
    )
  })

  it('keeps different kinds apart, so a headshot never supersedes a deck', () => {
    expect(versionGroupKey(file({ id: 'a', kind: 'slides' }))).not.toBe(
      versionGroupKey(file({ id: 'b', kind: 'headshot' })),
    )
  })
})

describe('fileVersions', () => {
  it('numbers by upload time and marks only the newest as latest', () => {
    const versions = fileVersions([
      file({ id: 'b', fileRequestAssignmentId: 'asg1', uploadedAt: '2026-08-03T09:00:00.000Z' }),
      file({ id: 'a', fileRequestAssignmentId: 'asg1', uploadedAt: '2026-08-01T09:00:00.000Z' }),
      file({ id: 'c', fileRequestAssignmentId: 'asg1', uploadedAt: '2026-08-05T09:00:00.000Z' }),
    ])

    expect(versions.get('a')).toMatchObject({ version: 1, isLatest: false, groupSize: 3 })
    expect(versions.get('b')).toMatchObject({ version: 2, isLatest: false })
    expect(versions.get('c')).toMatchObject({ version: 3, isLatest: true })
  })

  it('is stable when two uploads share a timestamp', () => {
    // Airtable timestamps are second-resolution, so a double-click really can produce two
    // rows with the same instant. The id breaks the tie, so the order does not change
    // between reads and "latest" does not flicker.
    const same = '2026-08-01T09:00:00.000Z'
    const versions = fileVersions([
      file({ id: 'z', fileRequestAssignmentId: 'asg1', uploadedAt: same }),
      file({ id: 'a', fileRequestAssignmentId: 'asg1', uploadedAt: same }),
    ])

    expect(versions.get('a')?.version).toBe(1)
    expect(versions.get('z')?.isLatest).toBe(true)
  })

  it('treats a lone upload as version 1 and latest', () => {
    const versions = fileVersions([file({ id: 'a' })])
    expect(versions.get('a')).toMatchObject({ version: 1, isLatest: true, groupSize: 1 })
  })

  it('counts groups independently', () => {
    const versions = fileVersions([
      file({ id: 'a', submissionId: 'sub1' }),
      file({ id: 'b', submissionId: 'sub1', uploadedAt: '2026-08-02T09:00:00.000Z' }),
      file({ id: 'c', submissionId: 'sub2' }),
    ])

    expect(versions.get('b')).toMatchObject({ version: 2, isLatest: true })
    expect(versions.get('c')).toMatchObject({ version: 1, isLatest: true, groupSize: 1 })
  })
})

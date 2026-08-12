import { describe, expect, it } from 'vitest'

import {
  buildFileRows,
  fileSizeLabel,
  fileTypeLabel,
  inFileScope,
} from '@/features/files/file-rows'
import type { Speaker, StoredFile, SubmissionWithParticipants } from '@/types/domain'

const speaker = (id: string, firstName: string, lastName = 'Lee', email = 'a@b.co') =>
  ({ id, firstName, lastName, email, eventIds: [], links: {} }) as unknown as Speaker

const submission = (id: string, code: string, title: string) =>
  ({ id, code, title }) as unknown as SubmissionWithParticipants

const file = (over: Partial<StoredFile> & Pick<StoredFile, 'id' | 'speakerId'>): StoredFile => ({
  kind: 'doc',
  objectKey: `objects/${over.id}`,
  visibility: 'public',
  contentType: 'application/pdf',
  filename: `${over.id}.pdf`,
  size: 2 * 1024 * 1024,
  uploadedAt: '2026-05-01T10:00:00.000Z',
  ...over,
})

const lookups = {
  speakers: [speaker('spk1', 'Ada'), speaker('spk2', 'Grace')],
  submissions: [submission('sub1', 'SESS-1', 'Scaling Postgres')],
  formatDate: (iso: string) => iso.slice(0, 10),
}

describe('inFileScope', () => {
  it('puts a session attachment on the submissions list and a loose upload on the portal one', () => {
    const attached = file({ id: 'f1', speakerId: 'spk1', submissionId: 'sub1' })
    const loose = file({ id: 'f2', speakerId: 'spk1' })

    expect(inFileScope(attached, 'submissions')).toBe(true)
    expect(inFileScope(attached, 'portal')).toBe(false)
    expect(inFileScope(loose, 'portal')).toBe(true)
    expect(inFileScope(loose, 'submissions')).toBe(false)
  })

  it('keeps a requested document on the portal list even when it is filed against a session', () => {
    // The defect: a per-session file request is answered from the portal, the row gets a
    // `submissionId`, and PORTALS > Files ("headshots and requested documents, uploaded
    // through the portal") then omitted the requested document it names. Both lists claim
    // this file, so it is on both.
    const requested = file({
      id: 'f1',
      speakerId: 'spk1',
      submissionId: 'sub1',
      fileRequestAssignmentId: 'fra1',
    })

    expect(inFileScope(requested, 'portal')).toBe(true)
    expect(inFileScope(requested, 'submissions')).toBe(true)
  })
})

describe('buildFileRows', () => {
  it('labels the session, the owner and the type', () => {
    const rows = buildFileRows(
      [file({ id: 'f1', speakerId: 'spk1', submissionId: 'sub1', kind: 'slides' })],
      'submissions',
      lookups,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionLabel: 'SESS-1 Scaling Postgres',
      speakerLabel: 'Ada Lee',
      typeLabel: 'Slides',
      sizeLabel: '2 MB',
      uploadedText: '2026-05-01',
      requested: false,
    })
  })

  it('marks a file that arrived against a file request', () => {
    const rows = buildFileRows(
      [file({ id: 'f1', speakerId: 'spk1', fileRequestAssignmentId: 'fra1' })],
      'portal',
      lookups,
    )

    expect(rows[0]?.requested).toBe(true)
    expect(rows[0]?.sessionLabel).toBeUndefined()
  })

  it('drops a file whose submission belongs to another event rather than showing it blank', () => {
    const rows = buildFileRows(
      [file({ id: 'f1', speakerId: 'spk1', submissionId: 'sub-elsewhere' })],
      'submissions',
      lookups,
    )

    expect(rows).toEqual([])
  })

  it('drops a file from another event on the portal list too, not just its label', () => {
    // The portal scope admits a file with a submission now, so the filename of a document
    // delivered at another event would otherwise appear here with a blank Session cell.
    const rows = buildFileRows(
      [
        file({
          id: 'f1',
          speakerId: 'spk1',
          submissionId: 'sub-elsewhere',
          fileRequestAssignmentId: 'fra1',
        }),
      ],
      'portal',
      lookups,
    )

    expect(rows).toEqual([])
  })

  it('names an owner the roster no longer holds instead of leaving the cell blank', () => {
    const rows = buildFileRows([file({ id: 'f1', speakerId: 'gone' })], 'portal', lookups)

    expect(rows[0]?.speakerLabel).toBe('Unknown speaker')
  })

  it('sorts newest first', () => {
    const rows = buildFileRows(
      [
        file({ id: 'old', speakerId: 'spk1', uploadedAt: '2026-01-01T00:00:00.000Z' }),
        file({ id: 'new', speakerId: 'spk2', uploadedAt: '2026-06-01T00:00:00.000Z' }),
      ],
      'portal',
      lookups,
    )

    expect(rows.map((row) => row.id)).toEqual(['new', 'old'])
  })
})

describe('fileSizeLabel', () => {
  it('never reports a stored file as 0 KB, which reads as broken', () => {
    expect(fileSizeLabel(1)).toBe('1 KB')
    expect(fileSizeLabel(0)).toBe('1 KB')
  })

  it('switches to megabytes at one', () => {
    expect(fileSizeLabel(900 * 1024)).toBe('900 KB')
    expect(fileSizeLabel(4 * 1024 * 1024)).toBe('4 MB')
  })
})

describe('fileTypeLabel', () => {
  it('never shows the stored value raw', () => {
    expect(fileTypeLabel('headshot')).toBe('Headshot')
    expect(fileTypeLabel('doc')).toBe('Document')
    expect(fileTypeLabel('slides')).toBe('Slides')
  })
})

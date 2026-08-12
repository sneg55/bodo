// The Files list's search, filter and sort.
//
// The defect these pin: the Columns, Sort and Filter panes over this table were built from the
// SESSION registry and committed nothing, so every one of them was a control that could not
// change the table. What the panes offer now is exactly what these accessors can answer.

import { describe, expect, it } from 'vitest'

import { FILE_ACCESSORS, FILE_QUERYABLE_KEYS, queryFiles } from '@/features/files/files-query'
import type { FileListRow } from '@/features/files/reads'

function row(overrides: Partial<FileListRow> = {}): FileListRow {
  return {
    id: 'recFile1',
    filename: 'deck.pdf',
    objectKey: 'slides/recSpeakerOwner/deck.pdf',
    sizeLabel: '2 MB',
    typeLabel: 'Slides',
    speakerLabel: 'Ada Okafor',
    requested: false,
    visibility: 'private',
    uploadedAt: '2026-08-09T10:00:00.000Z',
    uploadedText: 'Aug 9, 2026, 10:00 AM',
    version: 1,
    isLatest: true,
    groupSize: 1,
    comments: [],
    ...overrides,
  }
}

const rows: readonly FileListRow[] = [
  row({ id: 'a', filename: 'deck.pdf', uploadedAt: '2026-08-09T10:00:00.000Z' }),
  row({
    id: 'b',
    filename: 'release.pdf',
    typeLabel: 'Document',
    speakerLabel: 'Bo Lin',
    sessionLabel: 'SESS-2 Scaling Postgres',
    requested: true,
    uploadedAt: '2026-12-01T10:00:00.000Z',
    uploadedText: 'Dec 1, 2026, 10:00 AM',
  }),
]
const base = { search: '', filters: [], sort: null }

describe('queryFiles', () => {
  it('searches the filename, the speaker, the session and the type', () => {
    expect(queryFiles(rows, { ...base, search: 'release' }).map((file) => file.id)).toEqual(['b'])
    expect(queryFiles(rows, { ...base, search: 'Ada' }).map((file) => file.id)).toEqual(['a'])
    expect(queryFiles(rows, { ...base, search: 'Postgres' }).map((file) => file.id)).toEqual(['b'])
  })

  it('applies a filter from the drawer', () => {
    const filtered = queryFiles(rows, {
      ...base,
      filters: [{ id: 'f0', key: 'file-type', operator: 'is', value: 'Document' }],
    })

    expect(filtered.map((file) => file.id)).toEqual(['b'])
  })

  it('sorts an upload by its instant, not by the text of the date', () => {
    // `Aug 9` sorts before `Dec 1` chronologically and after it alphabetically, which is the
    // bug a text sort would ship on the one column an organizer orders this table by.
    expect(
      queryFiles(rows, { ...base, sort: { key: 'file-uploaded', direction: 'asc' } }).map(
        (file) => file.id,
      ),
    ).toEqual(['a', 'b'])
  })

  it('offers only keys it can answer, so no pane can hold a no-op condition', () => {
    for (const key of FILE_QUERYABLE_KEYS) {
      expect(FILE_ACCESSORS.text(rows[0], key)).toBeTypeOf('string')
    }
    // A key with no accessor reads as undefined, which the engine treats as "cannot evaluate".
    expect(FILE_ACCESSORS.text(rows[0], 'file-comments')).toBeUndefined()
  })
})

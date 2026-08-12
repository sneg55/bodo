// Selecting a bundle by file row: the scope intersection and the version promotion.
//
// Both are one line away from a wrong archive that nothing else would catch. A broken
// intersection streams another event's objects; a broken promotion ships four copies of one
// deck, or silently drops a file the organizer watched themselves tick.

import { describe, expect, it } from 'vitest'

import {
  fileSelectionScope,
  MAX_BUNDLE_FILES,
  promoteToLatest,
} from '@/features/bundle/file-selection'
import type { VersionedFile } from '@/features/bundle/selection'

const EVENT_FILES = ['f-1', 'f-2', 'f-3', 'f-4']

function file(over: Partial<VersionedFile> & { id: string }): VersionedFile {
  return {
    speakerId: 'spk-1',
    submissionId: 'sub-1',
    kind: 'slides',
    filename: 'deck.pdf',
    uploadedAt: '2026-08-01T10:00:00.000Z',
    ...over,
  }
}

describe('fileSelectionScope', () => {
  it('keeps only the ticked ids the event holds', () => {
    const scope = fileSelectionScope({
      eventFileIds: EVENT_FILES,
      checkedIds: ['f-2', 'f-4'],
    })

    expect(scope.fileIds).toEqual(['f-2', 'f-4'])
    expect(scope.foreign).toBe(0)
    expect(scope.problem).toBeUndefined()
  })

  it('drops an id from another event and counts it', () => {
    const scope = fileSelectionScope({
      eventFileIds: EVENT_FILES,
      checkedIds: ['f-1', 'recSomeoneElse', 'recSomeoneElse2'],
    })

    expect(scope.fileIds).toEqual(['f-1'])
    expect(scope.foreign).toBe(2)
  })

  it('answers in the event read order, not the order the ticks arrived', () => {
    const scope = fileSelectionScope({
      eventFileIds: EVENT_FILES,
      checkedIds: ['f-4', 'f-1'],
    })

    expect(scope.fileIds).toEqual(['f-1', 'f-4'])
  })

  it('reports an empty selection rather than treating it as everything', () => {
    const scope = fileSelectionScope({ eventFileIds: EVENT_FILES, checkedIds: [] })

    expect(scope.fileIds).toEqual([])
    expect(scope.problem).toBe('empty')
  })

  it('reports a selection that resolves past the cap', () => {
    const ids = Array.from({ length: MAX_BUNDLE_FILES + 1 }, (_, index) => `f-${String(index)}`)

    const scope = fileSelectionScope({ eventFileIds: ids, checkedIds: ids })

    expect(scope.problem).toBe('too-many')
  })

  it('allows a selection exactly at the cap', () => {
    const ids = Array.from({ length: MAX_BUNDLE_FILES }, (_, index) => `f-${String(index)}`)

    expect(fileSelectionScope({ eventFileIds: ids, checkedIds: ids }).problem).toBeUndefined()
  })
})

describe('promoteToLatest', () => {
  const v1 = file({ id: 'f-1', uploadedAt: '2026-08-01T10:00:00.000Z' })
  const v2 = file({ id: 'f-2', uploadedAt: '2026-08-02T10:00:00.000Z' })
  const other = file({ id: 'f-3', filename: 'notes.pdf' })
  const all = [v1, v2, other]

  it('answers a tick on a superseded row with the newest upload of the same file', () => {
    expect(promoteToLatest(all, ['f-1']).map((f) => f.id)).toEqual(['f-2'])
  })

  it('collapses two versions of one file ticked together into a single member', () => {
    expect(promoteToLatest(all, ['f-1', 'f-2']).map((f) => f.id)).toEqual(['f-2'])
  })

  it('leaves untouched version groups out', () => {
    expect(promoteToLatest(all, ['f-3']).map((f) => f.id)).toEqual(['f-3'])
  })

  it('treats a file request assignment as the identity, whatever the upload was called', () => {
    const first = file({
      id: 'f-10',
      fileRequestAssignmentId: 'asg-1',
      filename: 'contract.pdf',
      uploadedAt: '2026-08-01T10:00:00.000Z',
    })
    const second = file({
      id: 'f-11',
      fileRequestAssignmentId: 'asg-1',
      filename: 'contract-FINAL-v3.pdf',
      uploadedAt: '2026-08-05T10:00:00.000Z',
    })

    expect(promoteToLatest([first, second], ['f-10']).map((f) => f.id)).toEqual(['f-11'])
  })

  it('keeps the same filename on two sessions apart', () => {
    const onA = file({ id: 'f-20', submissionId: 'sub-a' })
    const onB = file({ id: 'f-21', submissionId: 'sub-b' })

    expect(promoteToLatest([onA, onB], ['f-20', 'f-21']).map((f) => f.id)).toEqual(['f-20', 'f-21'])
  })

  it('follows the input order rather than the order the ticks arrived', () => {
    expect(promoteToLatest(all, ['f-3', 'f-2']).map((f) => f.id)).toEqual(['f-2', 'f-3'])
  })

  it('returns nothing for a tick on an id the input does not hold', () => {
    expect(promoteToLatest(all, ['recElsewhere'])).toEqual([])
  })
})

// The three selection rules the reference settles, asserted directly.
//
// docs/parity/external-references.md, "Bulk file download": scope is the CHECKED SELECTION,
// individual files can be deselected in the modal, and "Previous versions cannot be included
// in a file". Each of those is a one-line mistake away from a bundle that looks right and is
// not, which is why they are pure functions with tests rather than inline filters.

import { describe, expect, it } from 'vitest'

import {
  latestVersionsOnly,
  MAX_BUNDLE_SESSIONS,
  sessionScope,
  type VersionedFile,
  withoutDeselected,
} from '@/features/bundle/selection'

const EVENT_SESSIONS = ['sub-1', 'sub-2', 'sub-3', 'sub-4']

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

describe('sessionScope', () => {
  it('is the checked selection, not the whole event', () => {
    const scope = sessionScope({
      eventSessionIds: EVENT_SESSIONS,
      checkedIds: ['sub-3', 'sub-1'],
    })

    expect(scope.sessionIds).toEqual(['sub-1', 'sub-3'])
    expect(scope.problem).toBeUndefined()
  })

  it('refuses an empty tick set rather than treating it as everything', () => {
    const scope = sessionScope({ eventSessionIds: EVENT_SESSIONS, checkedIds: [] })

    expect(scope.sessionIds).toEqual([])
    expect(scope.problem).toBe('empty')
  })

  it('drops an id the event does not contain and counts it', () => {
    const scope = sessionScope({
      eventSessionIds: EVENT_SESSIONS,
      checkedIds: ['sub-2', 'sub-from-another-conference'],
    })

    expect(scope.sessionIds).toEqual(['sub-2'])
    expect(scope.foreign).toBe(1)
  })

  it('is empty, not partial, when every checked id is foreign', () => {
    const scope = sessionScope({ eventSessionIds: EVENT_SESSIONS, checkedIds: ['nope', 'also-no'] })

    expect(scope.sessionIds).toEqual([])
    expect(scope.foreign).toBe(2)
    expect(scope.problem).toBe('empty')
  })

  it('counts a repeated foreign id once', () => {
    const scope = sessionScope({
      eventSessionIds: EVENT_SESSIONS,
      checkedIds: ['sub-1', 'ghost', 'ghost'],
    })

    expect(scope.foreign).toBe(1)
  })

  it('returns the event order, not the click order', () => {
    const scope = sessionScope({
      eventSessionIds: EVENT_SESSIONS,
      checkedIds: ['sub-4', 'sub-2', 'sub-1'],
    })

    expect(scope.sessionIds).toEqual(['sub-1', 'sub-2', 'sub-4'])
  })

  it('reports too-many past the cap and stays silent at it', () => {
    const ids = Array.from({ length: MAX_BUNDLE_SESSIONS + 1 }, (_u, at) => `sub-${String(at)}`)

    expect(sessionScope({ eventSessionIds: ids, checkedIds: ids }).problem).toBe('too-many')
    expect(
      sessionScope({ eventSessionIds: ids, checkedIds: ids.slice(0, MAX_BUNDLE_SESSIONS) }).problem,
    ).toBeUndefined()
  })
})

describe('latestVersionsOnly', () => {
  it('keeps one row when the same filename was uploaded twice', () => {
    const kept = latestVersionsOnly([
      file({ id: 'f-old', uploadedAt: '2026-08-01T10:00:00.000Z' }),
      file({ id: 'f-new', uploadedAt: '2026-08-04T09:00:00.000Z' }),
    ])

    expect(kept.map((entry) => entry.id)).toEqual(['f-new'])
  })

  it('matches filenames case insensitively, since a browser re-upload keeps the name', () => {
    const kept = latestVersionsOnly([
      file({ id: 'f-old', filename: 'Deck.PDF' }),
      file({ id: 'f-new', filename: 'deck.pdf', uploadedAt: '2026-08-05T09:00:00.000Z' }),
    ])

    expect(kept).toHaveLength(1)
    expect(kept.at(0)?.id).toBe('f-new')
  })

  it('treats the same name on two sessions as two files, not two versions', () => {
    const kept = latestVersionsOnly([
      file({ id: 'f-a', submissionId: 'sub-1' }),
      file({ id: 'f-b', submissionId: 'sub-2', uploadedAt: '2026-08-09T09:00:00.000Z' }),
    ])

    expect(kept.map((entry) => entry.id)).toEqual(['f-a', 'f-b'])
  })

  it('treats the same name from two speakers as two files', () => {
    const kept = latestVersionsOnly([
      file({ id: 'f-a', speakerId: 'spk-1' }),
      file({ id: 'f-b', speakerId: 'spk-2' }),
    ])

    expect(kept).toHaveLength(2)
  })

  it('collapses two answers to one file request even when the names differ', () => {
    const kept = latestVersionsOnly([
      file({ id: 'f-old', fileRequestAssignmentId: 'fra-1', filename: 'release.pdf' }),
      file({
        id: 'f-new',
        fileRequestAssignmentId: 'fra-1',
        filename: 'release-signed-final.pdf',
        uploadedAt: '2026-08-07T12:00:00.000Z',
      }),
    ])

    expect(kept.map((entry) => entry.id)).toEqual(['f-new'])
  })

  it('breaks a same-instant tie on the record id, so two downloads agree', () => {
    const rows = [
      file({ id: 'f-aaa', uploadedAt: '2026-08-01T10:00:00.000Z' }),
      file({ id: 'f-zzz', uploadedAt: '2026-08-01T10:00:00.000Z' }),
    ]

    expect(latestVersionsOnly(rows).at(0)?.id).toBe('f-zzz')
    expect(latestVersionsOnly([...rows].reverse()).at(0)?.id).toBe('f-zzz')
  })

  it('keeps first-seen order for the survivors', () => {
    const kept = latestVersionsOnly([
      file({ id: 'f-1', filename: 'a.pdf' }),
      file({ id: 'f-2', filename: 'b.pdf' }),
      file({ id: 'f-3', filename: 'a.pdf', uploadedAt: '2026-08-08T10:00:00.000Z' }),
    ])

    expect(kept.map((entry) => entry.id)).toEqual(['f-3', 'f-2'])
  })

  it('is a no-op on an empty list', () => {
    expect(latestVersionsOnly([])).toEqual([])
  })
})

describe('withoutDeselected', () => {
  it('drops what the modal unticked', () => {
    const rows = [{ id: 'f-1' }, { id: 'f-2' }, { id: 'f-3' }]

    expect(withoutDeselected(rows, ['f-2']).map((row) => row.id)).toEqual(['f-1', 'f-3'])
  })

  it('returns the same list when nothing was unticked', () => {
    const rows = [{ id: 'f-1' }]

    expect(withoutDeselected(rows, [])).toBe(rows)
  })

  it('ignores an id that is not in the list', () => {
    expect(withoutDeselected([{ id: 'f-1' }], ['f-9'])).toHaveLength(1)
  })

  it('can empty the list, which is what disables Generate Download', () => {
    expect(withoutDeselected([{ id: 'f-1' }], ['f-1'])).toEqual([])
  })
})

// What the speaker's own Files card says about their own uploads.
//
// The organizer side has been right since versions shipped: PROGRAM > Files chips the two
// uploads `Latest of 2` and `v1` and puts a Download on each. The speaker looking at the
// same two objects got two identical `slides.pdf / 605 B / Private` lines with nothing to
// click. These pin the projection that closes that, and they are worth pinning because both
// failure directions are silent: presenting the OLD upload as current tells a speaker their
// correction landed when it did not, and a card with no link at all still renders fine.

import { describe, expect, it } from 'vitest'

import {
  formatFileSize,
  portalFileHref,
  submissionFileViews,
} from '@/features/portal/submission-files'
import type { StoredFile } from '@/types/domain'

const file = (overrides: Partial<StoredFile> & { id: string }): StoredFile => ({
  speakerId: 'spk1',
  submissionId: 'sub1',
  kind: 'slides',
  objectKey: `key/${overrides.id}`,
  visibility: 'private',
  contentType: 'application/pdf',
  filename: 'slides.pdf',
  size: 605,
  uploadedAt: '2026-08-09T09:00:00.000Z',
  ...overrides,
})

const lookups = {
  // Date AND time, because that is the whole point of the second half of the fix. The real
  // one is `dateTimeText` in the event's zone; this one is deterministic.
  formatDateTime: (iso: string) => iso.replace('T', ' ').replace('.000Z', ' UTC'),
  publicUrl: (objectKey: string) => `https://cdn.example.com/${objectKey}`,
  submissionCode: 'SESS-3',
}

describe('submissionFileViews', () => {
  it('marks the newest upload latest and numbers the one it superseded', () => {
    // The exact case the evaluation found: two uploads of `slides.pdf` against one session,
    // rendered identically. They are now `Latest of 2` and `v1`.
    const views = submissionFileViews(
      [
        file({ id: 'a', uploadedAt: '2026-08-09T09:00:00.000Z' }),
        file({ id: 'b', uploadedAt: '2026-08-09T14:30:00.000Z' }),
      ],
      lookups,
    )

    expect(views.map((view) => [view.id, view.version, view.isLatest, view.groupSize])).toEqual([
      ['b', 2, true, 2],
      ['a', 1, false, 2],
    ])
  })

  it('orders newest first, so the current file is the top row', () => {
    const views = submissionFileViews(
      [
        file({ id: 'old', uploadedAt: '2026-08-01T09:00:00.000Z' }),
        file({ id: 'new', uploadedAt: '2026-08-09T09:00:00.000Z' }),
        file({ id: 'mid', uploadedAt: '2026-08-05T09:00:00.000Z' }),
      ],
      lookups,
    )

    expect(views.map((view) => view.id)).toEqual(['new', 'mid', 'old'])
  })

  it('orders two uploads made in the same second without flickering', () => {
    // Airtable timestamps are second-resolution, so a double-click really does produce two
    // rows at the same instant. The record id breaks the tie in both the ordering and the
    // version numbering, and it has to be the SAME tiebreak in both or the list would show
    // `v1` above `Latest of 2`.
    const same = '2026-08-09T09:00:00.000Z'
    const views = submissionFileViews(
      [file({ id: 'a', uploadedAt: same }), file({ id: 'z', uploadedAt: same })],
      lookups,
    )

    expect(views.map((view) => view.id)).toEqual(['z', 'a'])
    expect(views[0].isLatest).toBe(true)
    expect(views[1].version).toBe(1)
  })

  it('carries the time, not only the date, so same-day uploads can be told apart', () => {
    // The second half of the gap. Both of these read `Aug 9, 2026` before, so the version
    // chips were the only thing distinguishing them and nothing displayed could order them.
    const views = submissionFileViews(
      [
        file({ id: 'a', uploadedAt: '2026-08-09T09:00:00.000Z' }),
        file({ id: 'b', uploadedAt: '2026-08-09T14:30:00.000Z' }),
      ],
      lookups,
    )

    expect(views.map((view) => view.uploadedText)).toEqual([
      '2026-08-09 14:30:00 UTC',
      '2026-08-09 09:00:00 UTC',
    ])
    expect(new Set(views.map((view) => view.uploadedText)).size).toBe(2)
  })

  it('gives a private object the authenticated route and asks the browser to save it', () => {
    // This is what the card had nothing of. A private object has no public URL by design, so
    // the old card rendered a `Private` badge and stopped, and the speaker could not open
    // their own deck.
    const [view] = submissionFileViews([file({ id: 'a' })], lookups)

    expect(view.href).toBe('/api/portal/files/a?submission=SESS-3')
    expect(view.download).toBe(true)
  })

  it('links a public object straight at the bucket and opens it', () => {
    const [view] = submissionFileViews(
      [file({ id: 'a', visibility: 'public', objectKey: 'public/a.png' })],
      lookups,
    )

    expect(view.href).toBe('https://cdn.example.com/public/a.png')
    expect(view.download).toBe(false)
  })

  it('leaves a public object linkless when no bucket URL is configured, and says nothing else is wrong', () => {
    // A DEPLOYMENT fact (`R2_PUBLIC_BASE_URL` unset), not a property of the file. It costs
    // the row its link and must not cost the page.
    const [view] = submissionFileViews([file({ id: 'a', visibility: 'public' })], {
      ...lookups,
      publicUrl: () => undefined,
    })

    expect(view.href).toBeUndefined()
    expect(view.download).toBe(false)
  })

  it('treats a lone upload as version 1 and latest, and still links it', () => {
    const [view] = submissionFileViews([file({ id: 'a' })], lookups)

    expect(view).toMatchObject({ version: 1, isLatest: true, groupSize: 1 })
    expect(view.href).toBeDefined()
  })

  it('counts versions per group, so a headshot never supersedes a deck', () => {
    const views = submissionFileViews(
      [
        file({ id: 'deck1', kind: 'slides', uploadedAt: '2026-08-01T09:00:00.000Z' }),
        file({ id: 'deck2', kind: 'slides', uploadedAt: '2026-08-02T09:00:00.000Z' }),
        file({ id: 'shot', kind: 'headshot', uploadedAt: '2026-08-03T09:00:00.000Z' }),
      ],
      lookups,
    )

    const byId = new Map(views.map((view) => [view.id, view]))
    expect(byId.get('deck2')).toMatchObject({ version: 2, isLatest: true, groupSize: 2 })
    expect(byId.get('shot')).toMatchObject({ version: 1, isLatest: true, groupSize: 1 })
  })

  it('says so when there is nothing attached', () => {
    expect(submissionFileViews([], lookups)).toEqual([])
  })
})

describe('portalFileHref', () => {
  it('scopes to a submission when one is named, so a co-speaker can reach the deck', () => {
    expect(portalFileHref('recFile1', 'SESS-3')).toBe(
      '/api/portal/files/recFile1?submission=SESS-3',
    )
  })

  it('encodes the code rather than pasting it into the query', () => {
    expect(portalFileHref('recFile1', 'A B&C')).toBe(
      '/api/portal/files/recFile1?submission=A%20B%26C',
    )
  })

  it('omits the parameter for a speaker’s own upload, which is the narrower search', () => {
    expect(portalFileHref('recFile1')).toBe('/api/portal/files/recFile1')
  })
})

describe('formatFileSize', () => {
  it('shows bytes below a kilobyte rather than rounding a real file to 0 KB', () => {
    // `605 B` is what the evaluation saw on the card, and it is right: `0 KB` reads as a
    // broken row rather than as a small file.
    expect(formatFileSize(605)).toBe('605 B')
  })

  it('rounds to kilobytes and then to one decimal of a megabyte', () => {
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(1024 * 1024 * 3.5)).toBe('3.5 MB')
  })
})

// Internal notes on a CRM contact, as rules.
//
// Pure, so it is assertable without a base. Two things are worth pinning and both are about
// an APPEND-ONLY log: that a note which is only whitespace is refused rather than stored,
// since there is no delete to correct it with, and that the checked body is what comes back
// out, so a composer cannot validate one string and post a different one.

import { describe, expect, it } from 'vitest'

import { checkNoteBody, NOTE_MAX_LENGTH, speakerNoteRows } from '@/features/crm/notes'
import type { SpeakerNote } from '@/services/airtable/speaker-notes'

const AT = '2026-03-04T09:30:00.000Z'

const note = (over: Partial<SpeakerNote> = {}): SpeakerNote => ({
  id: 'nte1',
  speakerId: 'spk1',
  body: 'Said no for 2026, ask again in spring.',
  authorName: 'Ada Okafor',
  at: AT,
  ...over,
})

describe('checkNoteBody', () => {
  it('accepts an ordinary note and returns it trimmed', () => {
    const checked = checkNoteBody('  Wants a morning slot.\n')
    expect(checked).toEqual({ ok: true, body: 'Wants a morning slot.' })
  })

  it('returns the trimmed body rather than only a verdict', () => {
    // The whole reason it returns the value: a caller that checked one string and wrote the
    // raw one would store leading newlines the check said were not there.
    const checked = checkNoteBody('\n\n  keep  \n')
    expect(checked.ok && checked.body).toBe('keep')
  })

  it('refuses an empty note', () => {
    expect(checkNoteBody('').ok).toBe(false)
  })

  it('refuses a note that is only whitespace, which an empty check would let through', () => {
    expect(checkNoteBody('   \n\t ').ok).toBe(false)
  })

  it('refuses a note past the cap, measured after trimming', () => {
    const long = `${' '.repeat(20)}${'x'.repeat(NOTE_MAX_LENGTH + 1)}${' '.repeat(20)}`
    expect(checkNoteBody(long).ok).toBe(false)
  })

  it('accepts a note exactly at the cap, so the boundary is not off by one', () => {
    expect(checkNoteBody('x'.repeat(NOTE_MAX_LENGTH)).ok).toBe(true)
  })

  it('names a reason a person can act on when it refuses', () => {
    const checked = checkNoteBody('')
    expect(checked.ok ? '' : checked.reason).not.toBe('')
  })
})

describe('speakerNoteRows', () => {
  it('keeps the order it was handed, which is newest first from the read', () => {
    const rows = speakerNoteRows([note({ id: 'a' }), note({ id: 'b' })], 'UTC')
    expect(rows.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('formats the timestamp on the server, in the timezone it is given', () => {
    const [utc] = speakerNoteRows([note()], 'UTC')
    const [tokyo] = speakerNoteRows([note()], 'Asia/Tokyo')
    expect(utc.atText).not.toBe('')
    expect(tokyo.atText).not.toBe(utc.atText)
  })

  it('leaves the timestamp empty for a row whose instant cannot be parsed', () => {
    expect(speakerNoteRows([note({ at: '' })], 'UTC')[0].atText).toBe('')
  })

  it('carries the author through, because attribution is the point of the feed', () => {
    expect(speakerNoteRows([note()], 'UTC')[0].authorName).toBe('Ada Okafor')
  })

  it('is empty for a contact nobody has written about', () => {
    expect(speakerNoteRows([], 'UTC')).toEqual([])
  })
})

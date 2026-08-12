// The CRM directory's row model: the projection the table sorts, filters and searches.
//
// Everything here is pure. The event links arrive with the speaker and the session casts
// arrive as a lookup, so the rules they encode (your events only, one session per
// submission however many roles somebody holds on it) are assertable without an Airtable
// base or a cache.

import { describe, expect, it } from 'vitest'

import {
  buildSpeakerRows,
  SPEAKER_ACCESSORS,
  type SpeakerRow,
  sessionCounts,
} from '@/features/crm/speaker-rows'

const row: SpeakerRow = {
  speaker: {
    id: 'spk1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    company: 'Analytical Engines',
    tagline: 'Numbers',
    links: {},
  },
  eventCount: 2,
  sessionCount: 3,
  tags: [{ id: 'tag1', name: 'Keynote', color: 'blue' }],
}

describe('SPEAKER_ACCESSORS', () => {
  it('exposes the full name for search and sort', () => {
    expect(SPEAKER_ACCESSORS.text(row, 'name')).toBe('Ada Lovelace')
  })

  it('treats the counts as numeric so they sort as numbers', () => {
    expect(SPEAKER_ACCESSORS.numeric('eventCount')).toBe(true)
    expect(SPEAKER_ACCESSORS.number(row, 'eventCount')).toBe(2)
  })

  it('joins tag names so a tag is filterable as text', () => {
    expect(SPEAKER_ACCESSORS.text(row, 'tags')).toBe('Keynote')
  })

  it('returns undefined for a key it does not know', () => {
    expect(SPEAKER_ACCESSORS.text(row, 'nope')).toBeUndefined()
  })

  it('searches name, email, company and tagline', () => {
    expect(SPEAKER_ACCESSORS.searchableKeys).toEqual(['name', 'email', 'company', 'tagline'])
  })

  it('falls back to the email when a row carries no name at all', () => {
    const nameless: SpeakerRow = {
      ...row,
      speaker: { ...row.speaker, firstName: '', lastName: '' },
    }
    expect(SPEAKER_ACCESSORS.text(nameless, 'name')).toBe('ada@example.com')
  })

  it('renders a missing optional as an empty string, not undefined', () => {
    // undefined would mean "this surface does not have that column", which
    // `matchesFilters` reads as "cannot evaluate, keep the row". An absent company is
    // a value, so `is empty` has to be able to match it.
    const bare: SpeakerRow = { ...row, speaker: { ...row.speaker, company: undefined } }
    expect(SPEAKER_ACCESSORS.text(bare, 'company')).toBe('')
  })

  it('flattens a biography to plain text, so a filter never matches markup', () => {
    const rich: SpeakerRow = {
      ...row,
      speaker: { ...row.speaker, bio: '<p>Wrote the <em>first</em> program</p>' },
    }
    expect(SPEAKER_ACCESSORS.text(rich, 'bio')).toBe('Wrote the first program')
  })

  it('keeps the WHOLE biography, so a filter can match past the cell width', () => {
    // It used to truncate here at 160 characters, which made `bio contains X` for an X
    // further in silently match nothing while looking like it worked. Truncation is a
    // property of the column's width and belongs in the cell, which is where it now lives.
    const long = `${'a '.repeat(200)}needle`
    const rich: SpeakerRow = { ...row, speaker: { ...row.speaker, bio: long } }
    expect(SPEAKER_ACCESSORS.text(rich, 'bio')).toContain('needle')
    expect(SPEAKER_ACCESSORS.text(rich, 'bio')).not.toContain('...')
  })

  it('does not sort text columns numerically', () => {
    expect(SPEAKER_ACCESSORS.numeric('name')).toBe(false)
    expect(SPEAKER_ACCESSORS.number(row, 'name')).toBeUndefined()
  })
})

describe('sessionCounts', () => {
  it('counts one session per submission the speaker is cast in', () => {
    const counts = sessionCounts([
      { eventId: 'e1', sessionCasts: [['spk1', 'spk2'], ['spk1'], ['spk2']] },
    ])
    expect(counts.get('spk1')).toBe(2)
    expect(counts.get('spk2')).toBe(2)
  })

  it('adds up across every event in the scope', () => {
    const counts = sessionCounts([
      { eventId: 'e1', sessionCasts: [['spk1']] },
      { eventId: 'e2', sessionCasts: [['spk1'], ['spk1']] },
    ])
    expect(counts.get('spk1')).toBe(3)
  })

  it('counts a co-presenter listed twice on one submission once', () => {
    // A speaker can hold two roles on the same session (presenter and chairperson).
    // That is one session, not two.
    expect(sessionCounts([{ eventId: 'e1', sessionCasts: [['spk1', 'spk1']] }]).get('spk1')).toBe(1)
  })

  it('says nothing about a speaker cast in nothing', () => {
    expect(sessionCounts([{ eventId: 'e1', sessionCasts: [] }]).has('spk1')).toBe(false)
  })
})

describe('buildSpeakerRows', () => {
  const speakers = [
    { speaker: row.speaker, eventIds: ['e1', 'e2'] },
    { speaker: { ...row.speaker, id: 'spk2', email: 'bob@example.com' }, eventIds: ['e1'] },
  ]

  it('counts events off the links the roster read kept, and sessions off the lookup', () => {
    const rows = buildSpeakerRows(speakers, {
      sessionCounts: new Map([['spk1', 3]]),
      tagsBySpeaker: new Map([['spk1', [{ id: 'tag1', name: 'Keynote', color: 'blue' }]]]),
    })
    expect(rows[0]).toEqual(row)
  })

  it('reads zero, not blank, for a speaker cast in nothing', () => {
    const rows = buildSpeakerRows(speakers, {
      sessionCounts: new Map(),
      tagsBySpeaker: new Map(),
    })
    expect(rows[1]).toEqual({
      speaker: speakers[1].speaker,
      // One event, no sessions: exactly what an imported speaker looks like before they
      // submit anything, and the reason the count is not derived from submissions.
      eventCount: 1,
      sessionCount: 0,
      tags: [],
    })
  })

  it('keeps the order the reader gave', () => {
    const rows = buildSpeakerRows(speakers, {
      sessionCounts: new Map(),
      tagsBySpeaker: new Map(),
    })
    expect(rows.map((entry) => entry.speaker.id)).toEqual(['spk1', 'spk2'])
  })
})

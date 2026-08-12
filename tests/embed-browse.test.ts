// Visitor-facing search and facets on a served embed.
//
// The multi-term rule is the one worth pinning: a single-string substring test passes the
// obvious cases and then quietly answers "ada retrieval" with nothing, which is exactly the
// query somebody types when they know both halves of what they are looking for.

import { describe, expect, it } from 'vitest'

import {
  embedFacetValues,
  embedResultCountLabel,
  isEmbedNarrowed,
  matchesEmbedQuery,
  toggleFacetValue,
} from '@/features/cms/embed-browse'

const SESSION = {
  title: 'Retrieval that survives production traffic',
  speakers: ['Ada Okafor', 'Chen Wei'],
  description: 'Vector indexes nobody wants to think about.',
}

describe('matchesEmbedQuery', () => {
  it('admits everything when nothing has been typed', () => {
    expect(matchesEmbedQuery(SESSION, '')).toBe(true)
    expect(matchesEmbedQuery(SESSION, '   ')).toBe(true)
  })

  it('matches the title', () => {
    expect(matchesEmbedQuery(SESSION, 'production')).toBe(true)
  })

  it('matches a SPEAKER name, which is half of what the control is for', () => {
    // A visitor typing a surname into a conference agenda is looking for a person. A
    // title-only search answers that with nothing while the name is on the card.
    expect(matchesEmbedQuery(SESSION, 'okafor')).toBe(true)
    expect(matchesEmbedQuery(SESSION, 'chen')).toBe(true)
  })

  it('matches the description', () => {
    expect(matchesEmbedQuery(SESSION, 'vector')).toBe(true)
  })

  it('requires EVERY term, and each may match a different field', () => {
    // The case a single substring test gets wrong: this string appears nowhere as a run.
    expect(matchesEmbedQuery(SESSION, 'ada retrieval')).toBe(true)
    expect(matchesEmbedQuery(SESSION, 'ada quantum')).toBe(false)
  })

  it('ignores case and surrounding whitespace', () => {
    expect(matchesEmbedQuery(SESSION, '  ADA  ')).toBe(true)
  })

  it('ignores accents, in both directions', () => {
    // A roster of international speakers is exactly where this is a bug rather than a nicety.
    const jose = { title: 'Talk', speakers: ['José Álvarez'] }

    expect(matchesEmbedQuery(jose, 'jose')).toBe(true)
    expect(matchesEmbedQuery(jose, 'alvarez')).toBe(true)
    expect(matchesEmbedQuery({ title: 'Jose Talk', speakers: [] }, 'josé')).toBe(true)
  })

  it('does not match when nothing does', () => {
    expect(matchesEmbedQuery(SESSION, 'keynote')).toBe(false)
  })

  it('tolerates a session with no description and no speakers', () => {
    expect(matchesEmbedQuery({ title: 'Opening', speakers: [] }, 'opening')).toBe(true)
    expect(matchesEmbedQuery({ title: 'Opening', speakers: [] }, 'ada')).toBe(false)
  })
})

describe('embedFacetValues', () => {
  const rows = [
    { track: 'Agents' },
    { track: 'Retrieval' },
    { track: 'Agents' },
    { track: undefined },
    { track: '' },
  ]

  it('offers each distinct value once, sorted', () => {
    expect(embedFacetValues(rows, (row) => row.track)).toEqual(['Agents', 'Retrieval'])
  })

  it('offers nothing for a dimension no rendered session carries', () => {
    // Built from what is on screen, not from the event's full track list: a filter offering
    // a track with nothing in it can only ever produce an empty list, which reads as broken.
    expect(embedFacetValues(rows, () => undefined)).toEqual([])
  })
})

describe('toggleFacetValue', () => {
  it('ticks and unticks', () => {
    expect(toggleFacetValue([], 'Agents')).toEqual(['Agents'])
    expect(toggleFacetValue(['Agents', 'Retrieval'], 'Agents')).toEqual(['Retrieval'])
  })
})

/** Nothing narrowed. Each case below turns exactly one thing on. */
const OPEN = {
  onlyMine: false,
  scheduled: [],
  day: undefined,
  tracks: [],
  rooms: [],
  formats: [],
  query: '',
}

describe('isEmbedNarrowed', () => {
  it('is false when the whole programme is on screen', () => {
    expect(isEmbedNarrowed(OPEN)).toBe(false)
  })

  it('counts every dimension a control can set', () => {
    expect(isEmbedNarrowed({ ...OPEN, onlyMine: true })).toBe(true)
    expect(isEmbedNarrowed({ ...OPEN, day: 'd1' })).toBe(true)
    expect(isEmbedNarrowed({ ...OPEN, tracks: ['Agents'] })).toBe(true)
    expect(isEmbedNarrowed({ ...OPEN, rooms: ['Hall A'] })).toBe(true)
    expect(isEmbedNarrowed({ ...OPEN, formats: ['Workshop'] })).toBe(true)
    expect(isEmbedNarrowed({ ...OPEN, query: 'ada' })).toBe(true)
  })

  it('does not count a query of whitespace', () => {
    // `matchesEmbedQuery` admits everything for one, so calling it a narrowing would print
    // "13 of 13 sessions" over a list nothing had been done to.
    expect(isEmbedNarrowed({ ...OPEN, query: '   ' })).toBe(false)
  })

  it('does not count starred sessions on their own', () => {
    // Stars persist across page views. Having some is not the same as filtering to them.
    expect(isEmbedNarrowed({ ...OPEN, scheduled: ['s1', 's2'] })).toBe(false)
  })
})

describe('embedResultCountLabel', () => {
  it('names the whole list when nothing is narrowed', () => {
    expect(embedResultCountLabel({ total: 13, visible: 13, narrowed: false })).toBe('13 sessions')
  })

  it('names both numbers once something is', () => {
    // The line that has to MOVE when a filter is applied, which is the whole reason it exists.
    expect(embedResultCountLabel({ total: 13, visible: 3, narrowed: true })).toBe(
      '3 of 13 sessions',
    )
  })

  it('says nothing survived rather than going blank', () => {
    expect(embedResultCountLabel({ total: 13, visible: 0, narrowed: true })).toBe(
      '0 of 13 sessions',
    )
  })

  it('counts speakers when the caller says so, in both shapes', () => {
    // The speaker roster projects no sessions, so the default noun would print "12 sessions"
    // under a "Search speakers" box. The noun is a parameter for exactly that surface.
    const noun = { one: 'speaker', many: 'speakers' }
    expect(embedResultCountLabel({ total: 12, visible: 12, narrowed: false, noun })).toBe(
      '12 speakers',
    )
    expect(embedResultCountLabel({ total: 12, visible: 1, narrowed: true, noun })).toBe(
      '1 of 12 speakers',
    )
    expect(embedResultCountLabel({ total: 1, visible: 1, narrowed: false, noun })).toBe('1 speaker')
  })

  it('pluralises on the TOTAL, in both shapes', () => {
    // Pluralising on the visible count instead prints "1 of 13 session".
    expect(embedResultCountLabel({ total: 1, visible: 1, narrowed: false })).toBe('1 session')
    expect(embedResultCountLabel({ total: 1, visible: 0, narrowed: true })).toBe('0 of 1 session')
    expect(embedResultCountLabel({ total: 13, visible: 1, narrowed: true })).toBe(
      '1 of 13 sessions',
    )
  })
})

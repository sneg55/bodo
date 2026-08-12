// What a visitor's controls leave on screen, as one set of ids.
//
// This is the rule a day heading, a session row and the "nothing matched" line all read. They
// used to derive it separately, and the heading did not derive it at all: it was server-rendered
// per day while only the rows under it were narrowed, so the itinerary's `TUE` tab printed an
// empty `Mon, October 12, 2026` band above the Tuesday content, and `MY SCHEDULE` printed an
// empty `Tue` band under two starred Monday sessions. Both cases are pinned below.

import { describe, expect, it } from 'vitest'

import { browsableSessions } from '@/features/cms/browsable'
import {
  type EmbedNarrowing,
  type NarrowableSession,
  visibleEmbedSessionIds,
} from '@/features/cms/embed-browse'
import type { EmbedBody } from '@/features/cms/projection'

const NOTHING_NARROWED: EmbedNarrowing = {
  onlyMine: false,
  scheduled: [],
  tracks: [],
  rooms: [],
  formats: [],
  query: '',
}

const MONDAY = '2026-10-12'
const TUESDAY = '2026-10-13'

const SESSIONS: readonly NarrowableSession[] = [
  {
    id: 'mon-keynote',
    title: 'Sponsor keynote: the developer platform in 2027',
    speakers: ['Dara Nasser'],
    track: 'Product',
    room: 'Workshop A',
    format: 'Talk',
    dayKey: MONDAY,
  },
  {
    id: 'mon-lightning',
    title: 'Lightning: Agents in Production Q&A',
    speakers: ['Marcus Okafor'],
    room: 'Main Stage',
    dayKey: MONDAY,
  },
  {
    id: 'tue-retrieval',
    title: 'Retrieval that survives production traffic',
    speakers: ['Priya Raman'],
    description: '<p>Sharding, caching, and the failure modes.</p>',
    track: 'Infra',
    room: 'Workshop B',
    format: 'Workshop',
    dayKey: TUESDAY,
  },
]

const idsFor = (narrowing: Partial<EmbedNarrowing>): readonly string[] =>
  [...visibleEmbedSessionIds(SESSIONS, { ...NOTHING_NARROWED, ...narrowing })].toSorted()

describe('what the visitor has narrowed to', () => {
  it('admits everything when no control has been touched', () => {
    expect(idsFor({})).toEqual(['mon-keynote', 'mon-lightning', 'tue-retrieval'])
  })

  it('leaves a day with nothing in it, so its heading can hide', () => {
    // The `TUE` tab case: no Monday session survives, so `EmbedDaySection` finds none of its own
    // ids in the set and the Monday card does not render at all.
    const visible = visibleEmbedSessionIds(SESSIONS, { ...NOTHING_NARROWED, day: TUESDAY })

    expect([...visible]).toEqual(['tue-retrieval'])
    expect(SESSIONS.filter((s) => s.dayKey === MONDAY).some((s) => visible.has(s.id))).toBe(false)
  })

  it('leaves a day with nothing STARRED in it, which is the My Schedule case', () => {
    expect(idsFor({ onlyMine: true, scheduled: ['mon-keynote', 'mon-lightning'] })).toEqual([
      'mon-keynote',
      'mon-lightning',
    ])
  })

  it('matches titles, speaker names and the abstract, every term and any field', () => {
    expect(idsFor({ query: 'okafor' })).toEqual(['mon-lightning'])
    expect(idsFor({ query: 'sharding' })).toEqual(['tue-retrieval'])
    expect(idsFor({ query: 'priya sharding' })).toEqual(['tue-retrieval'])
    expect(idsFor({ query: 'priya keynote' })).toEqual([])
  })

  it('ORs within a facet and ANDs across them', () => {
    expect(idsFor({ rooms: ['Main Stage', 'Workshop B'] })).toEqual([
      'mon-lightning',
      'tue-retrieval',
    ])
    // Ticking a track AND a room admits only what satisfies both.
    expect(idsFor({ tracks: ['Infra'], rooms: ['Main Stage'] })).toEqual([])
  })

  it('excludes a session with no value on a filtered dimension', () => {
    // `mon-lightning` has no track. An untracked session cannot satisfy "track is Product", and
    // admitting it would drop every unlabelled session into every track-filtered view.
    expect(idsFor({ tracks: ['Product'] })).toEqual(['mon-keynote'])
  })

  it('combines the day with everything else, rather than replacing it', () => {
    expect(idsFor({ day: MONDAY, formats: ['Talk'] })).toEqual(['mon-keynote'])
    expect(idsFor({ day: TUESDAY, formats: ['Talk'] })).toEqual([])
  })
})

describe('what crosses into the browser', () => {
  const session = (id: string) => ({
    id,
    title: id,
    speakers: [],
    speakerIds: [],
    people: [],
    time: '9:00 AM',
  })

  it('carries the day on the session, which is what lets a heading hide itself', () => {
    const body: EmbedBody = {
      view: 'schedule_itinerary',
      days: [
        { key: MONDAY, label: 'Mon', sessions: [session('a'), session('b')] },
        { key: TUESDAY, label: 'Tue', sessions: [session('c')] },
      ],
    }

    expect(browsableSessions(body).map((entry) => [entry.id, entry.dayKey])).toEqual([
      ['a', MONDAY],
      ['b', MONDAY],
      ['c', TUESDAY],
    ])
  })

  it('carries no day on the flat list, which has no headings and no day tabs', () => {
    const body: EmbedBody = {
      view: 'session_list',
      sessions: [{ ...session('a'), dayLabel: 'Mon', stamp: 'Mon at 9:00 AM' }],
    }

    expect(browsableSessions(body)[0]?.dayKey).toBeUndefined()
  })

  it('leaves an absent field ABSENT rather than explicitly undefined', () => {
    const body: EmbedBody = {
      view: 'agenda',
      days: [{ key: MONDAY, label: 'Mon', sessions: [session('a')] }],
    }
    const keys = browsableSessions(body).flatMap((entry) => Object.keys(entry))

    // A facet tests membership, and `format: undefined` on the wire makes `'format' in session`
    // true while carrying no value.
    expect(keys).not.toContain('format')
    expect(keys).not.toContain('description')
    expect(keys).toContain('title')
  })

  it('yields nothing for the two rosters, so neither control bar renders over them', () => {
    expect(browsableSessions({ view: 'speaker_gallery', speakers: [] })).toEqual([])
    expect(browsableSessions({ view: 'speaker_list', speakers: [] })).toEqual([])
  })
})

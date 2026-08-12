// The embed's calendar feed: `/embed/<publicId>.ics`.
//
// A calendar file fails in a way nothing else here does: it is accepted by one client and refused
// by another, and the person who finds out is an attendee whose schedule is empty. So the checks
// below are on the BYTES (property names, CRLF, folding, escaping), not on a data structure, and
// the two that matter most are the ones no rendering would show:
//
//   - The organizer's Filters and Field Options apply here too. An embed narrowed to one track
//     must not publish the rest of the programme to anybody who subscribes to its calendar.
//   - A session with no times is left OUT rather than exported with a guessed hour, because a
//     wrong time in somebody's calendar is worse than a missing entry.
//
// The serializer itself is `buildSessionCalendar` (@/features/comms/ics), shared with the
// visitor's starred-schedule export and covered for folding and escaping by tests/ics*.test.ts.
// What is tested here is the feed that feeds it.

import { describe, expect, it } from 'vitest'

import { embedCalendarFilename, embedFeedIcs } from '@/features/cms/feed-ics'
import { embedFeed } from '@/features/cms/feed-model'
import { defaultEmbedFieldOptions, toggleEmbedField } from '@/features/cms/field-options'
import { EMPTY_EMBED_FILTERS, toggleEmbedFilter } from '@/features/cms/filters'
import { type EmbedSourceRow, embedProjection } from '@/features/cms/projection'
import { EMBED_DEFAULTS, type EmbedFieldOptions, type EmbedFilters } from '@/types/cms'
import type { Room, Track } from '@/types/domain'

const DTSTAMP = '2026-08-10T09:00:00.000Z'
const TIME_ZONE = 'America/New_York'

const ROOMS: readonly Room[] = [
  { id: 'recRoom1', eventId: 'recEvent', name: 'Main Stage; Level 2', order: 0 },
  { id: 'recRoom2', eventId: 'recEvent', name: 'Workshop Room', order: 1 },
]
const TRACKS: readonly Track[] = [
  { id: 'recTrackAgents', eventId: 'recEvent', name: 'Agents', color: 'blue', order: 0 },
  { id: 'recTrackOps', eventId: 'recEvent', name: 'Ops', color: 'green', order: 1 },
]
const ADA = { id: 'recAda', firstName: 'Ada', lastName: 'Okafor' }

/**
 * `EmbedSourceRow` plus the abstract.
 *
 * `description` is not on `EmbedSourceRow`, but it IS what `readServedEmbed` puts on every row it
 * hands the projection (`describeSessions` lifts it out of `answersJson`) and what
 * `groupPublicSchedule` reads structurally. So it reaches the output, and a fixture that omitted
 * it would leave the Description field untested.
 */
type SourceRow = EmbedSourceRow & { description?: string }

function row(patch: Partial<SourceRow> & { id: string; title: string }): SourceRow {
  return {
    status: 'accepted',
    scheduleStatus: 'published',
    calendarStatus: 'active',
    startsAt: '2026-10-12T16:00:00.000Z',
    endsAt: '2026-10-12T16:30:00.000Z',
    roomId: 'recRoom1',
    trackId: 'recTrackAgents',
    tagIds: [],
    participants: [{ speaker: ADA }],
    ...patch,
  }
}

const ROWS: readonly SourceRow[] = [
  row({
    id: 's1',
    title: 'Agent evaluation, part one',
    description: 'Line one\nLine two; with a semicolon.',
  }),
  row({
    id: 's2',
    title: 'Retrieval systems',
    startsAt: '2026-10-13T17:00:00.000Z',
    endsAt: '2026-10-13T17:45:00.000Z',
    roomId: 'recRoom2',
    trackId: 'recTrackOps',
  }),
]

function calendar(
  patch: {
    rows?: readonly SourceRow[]
    filters?: EmbedFilters
    fieldOptions?: EmbedFieldOptions
  } = {},
): string {
  const projection = embedProjection({
    embed: {
      enabled: true,
      // The route asks for the day-grouped session view whatever the embed's own view is, so
      // that is what these cases build: a calendar of a speaker roster would be empty.
      view: 'agenda',
      ...EMBED_DEFAULTS,
      filters: patch.filters ?? EMPTY_EMBED_FILTERS,
      fieldOptions: patch.fieldOptions ?? defaultEmbedFieldOptions(),
    },
    event: { name: 'AI.Engineer Sandbox Event, NYC', timezone: TIME_ZONE },
    rows: patch.rows ?? ROWS,
    rooms: ROOMS,
    tracks: TRACKS,
    deepLink: {},
  })
  if (projection === undefined) throw new Error('expected a projection')
  return embedFeedIcs({
    feed: embedFeed(projection, DTSTAMP),
    timeZone: TIME_ZONE,
    dtstamp: DTSTAMP,
  })
}

function lines(ics: string): readonly string[] {
  return ics.split('\r\n')
}

describe('the calendar is a valid VCALENDAR', () => {
  it('opens and closes, and declares a version and a method', () => {
    const ics = calendar()

    expect(lines(ics).at(0)).toBe('BEGIN:VCALENDAR')
    expect(lines(ics).at(-2)).toBe('END:VCALENDAR')
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('CALSCALE:GREGORIAN')
    // PUBLISH, not REQUEST: a feed is subscribed to, not an invitation awaiting an RSVP.
    expect(ics).toContain('METHOD:PUBLISH')
    expect(ics).toContain('PRODID:-//Bodo//Embed Feed//EN')
    // No invitation machinery on a published calendar.
    expect(ics).not.toContain('ORGANIZER')
    expect(ics).not.toContain('ATTENDEE')
  })

  it('names the calendar after the event and carries its timezone', () => {
    const ics = calendar()

    // The comma is escaped, because it separates values in an iCalendar TEXT property.
    expect(ics).toContain('X-WR-CALNAME:AI.Engineer Sandbox Event\\, NYC')
    expect(ics).toContain(`X-WR-TIMEZONE:${TIME_ZONE}`)
  })

  it('opens and closes one VEVENT per scheduled session', () => {
    const ics = calendar()

    expect(lines(ics).filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(2)
    expect(lines(ics).filter((line) => line === 'END:VEVENT')).toHaveLength(2)
  })

  it('gives each event a stable UID and the instants in UTC', () => {
    const ics = calendar()

    expect(ics).toContain('UID:s1@bodo')
    expect(ics).toContain('DTSTART:20261012T160000Z')
    expect(ics).toContain('DTEND:20261012T163000Z')
    expect(ics).toContain('DTSTAMP:20260810T090000Z')
    // Same input, same UIDs: re-importing updates the entries rather than duplicating them.
    expect(calendar()).toBe(ics)
  })

  it('carries the summary, the room and the abstract', () => {
    const ics = calendar()

    expect(ics).toContain('SUMMARY:Agent evaluation\\, part one')
    expect(ics).toContain('LOCATION:Main Stage\\; Level 2')
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two\\; with a semicolon.')
  })

  it('folds every line to 75 octets, which is where clients start refusing files', () => {
    const long = calendar({
      rows: [
        row({ id: 's1', title: `A very long session title that keeps going ${'x'.repeat(90)}` }),
      ],
    })

    for (const line of lines(long)) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75)
    }
    // Folded, not truncated: the continuation lines start with a space.
    expect(long).toContain('\r\n ')
  })
})

describe('the calendar publishes only what the embed publishes', () => {
  it('honours the organizer track filter', () => {
    const ics = calendar({
      filters: toggleEmbedFilter(EMPTY_EMBED_FILTERS, 'track', 'recTrackAgents', true),
    })

    expect(ics).toContain('UID:s1@bodo')
    expect(ics).not.toContain('UID:s2@bodo')
    expect(ics).not.toContain('Retrieval systems')
  })

  it('emits no LOCATION when the Room field is switched off', () => {
    const ics = calendar({
      fieldOptions: toggleEmbedField(defaultEmbedFieldOptions(), 'agenda', 'room', false),
    })

    expect(ics).not.toContain('LOCATION')
    expect(ics).not.toContain('Main Stage')
    // The session is still there; only the field it lost is gone.
    expect(ics).toContain('UID:s1@bodo')
  })

  it('emits no DESCRIPTION when the abstract is switched off', () => {
    const ics = calendar({
      fieldOptions: toggleEmbedField(defaultEmbedFieldOptions(), 'agenda', 'description', false),
    })

    expect(ics).not.toContain('DESCRIPTION')
  })

  it('never exports an unpublished session, whatever the calendar asks for', () => {
    const ics = calendar({
      rows: [
        row({ id: 's1', title: 'Public talk' }),
        row({ id: 'sHidden', title: 'Withdrawn talk', status: 'withdrawn' }),
      ],
    })

    expect(ics).toContain('UID:s1@bodo')
    expect(ics).not.toContain('Withdrawn talk')
  })

  it('leaves out a session whose time is still to be announced', () => {
    const ics = calendar({
      rows: [
        row({ id: 's1', title: 'Scheduled talk' }),
        row({ id: 'sTba', title: 'Unscheduled talk', startsAt: undefined, endsAt: undefined }),
      ],
    })

    expect(ics).toContain('SUMMARY:Scheduled talk')
    expect(ics).not.toContain('Unscheduled talk')
    expect(lines(ics).filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1)
  })
})

describe('the download filename', () => {
  it('is an ASCII slug of the event name', () => {
    expect(embedCalendarFilename('AI.Engineer Sandbox Event, NYC')).toBe(
      'ai-engineer-sandbox-event-nyc.ics',
    )
  })

  it('falls back rather than producing a header with nothing in it', () => {
    expect(embedCalendarFilename('   ')).toBe('agenda.ics')
    expect(embedCalendarFilename('日本語')).toBe('agenda.ics')
  })

  it('carries no quote, which would end the Content-Disposition value', () => {
    expect(embedCalendarFilename('Ada\'s "big" event')).not.toContain('"')
  })
})

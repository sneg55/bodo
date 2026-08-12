// What a public widget is able to SHOW, as opposed to which rows it shows.
//
// A review of the five served widgets found the same two omissions on four of them at once: no
// Format value anywhere in the public output, and speakers reduced to bare display names with no
// job title, no company, and (in a speaker's own profile) no date or room beside a session title.
// All four were one projection defect rather than four rendering defects, so they are pinned here
// once, at the projection, where a view cannot quietly stop honouring them.
//
// The rule that matters most is the NEGATIVE one: a submission carrying no Format still projects
// no Format. Nothing derives, defaults or invents a value on the read path.

import { describe, expect, it } from 'vitest'

import { embedChoiceLabel } from '@/features/cms/choice-label'
import { matchesSpeakerQuery } from '@/features/cms/EmbedSpeakerBrowse'
import { defaultEmbedFieldOptions } from '@/features/cms/field-options'
import { EMPTY_EMBED_FILTERS } from '@/features/cms/filters'
import { type EmbedSourceRow, embedProjection } from '@/features/cms/projection'
import { EMBED_DEFAULTS, type EmbedView } from '@/types/cms'
import type { Room, Track } from '@/types/domain'

const ROOMS: readonly Room[] = [
  { id: 'recRoom1', eventId: 'recEvent', name: 'Main Stage', order: 0 },
]
const TRACKS: readonly Track[] = [
  { id: 'recTrack1', eventId: 'recEvent', name: 'Agents', color: 'blue', order: 0 },
]

/** Carries both a job title and a company, which is what a programme prints beside a name. */
const ADA = {
  id: 'recAda',
  firstName: 'Ada',
  lastName: 'Okafor',
  tagline: 'Principal Engineer',
  company: 'Latticework Systems',
}
/** Carries neither, so the "degrades gracefully" half is covered by a real row. */
const CHEN = { id: 'recChen', firstName: 'Chen', lastName: 'Wei' }

function row(patch: Partial<EmbedSourceRow> & { id: string; title: string }): EmbedSourceRow {
  return {
    status: 'accepted',
    scheduleStatus: 'published',
    calendarStatus: 'active',
    startsAt: '2026-10-12T16:00:00.000Z',
    endsAt: '2026-10-12T16:30:00.000Z',
    roomId: 'recRoom1',
    trackId: 'recTrack1',
    tagIds: [],
    participants: [{ speaker: ADA }],
    ...patch,
  }
}

const ROWS: readonly EmbedSourceRow[] = [
  row({ id: 's1', title: 'Agent evaluation', format: 'lightning_talk' }),
  // No `format` at all, and a speaker with no tagline and no company.
  row({
    id: 's2',
    title: 'Retrieval systems',
    startsAt: '2026-10-13T17:00:00.000Z',
    endsAt: '2026-10-13T17:45:00.000Z',
    participants: [{ speaker: CHEN }],
  }),
]

function project(view: EmbedView, rows: readonly EmbedSourceRow[] = ROWS) {
  return embedProjection({
    embed: {
      enabled: true,
      view,
      ...EMBED_DEFAULTS,
      filters: EMPTY_EMBED_FILTERS,
      fieldOptions: defaultEmbedFieldOptions(),
    },
    event: { name: 'DevFlow Conf', timezone: 'America/New_York' },
    rows,
    rooms: ROOMS,
    tracks: TRACKS,
    deepLink: {},
  })
}

function daySessions(view: 'agenda' | 'schedule_itinerary') {
  const body = project(view)?.body
  return body?.view === view ? body.days.flatMap((day) => day.sessions) : []
}

function flatSessions() {
  const body = project('session_list')?.body
  return body?.view === 'session_list' ? body.sessions : []
}

describe('Format reaches every session surface', () => {
  it('labels the stored value for display on the day-grouped views', () => {
    // Both views share the Agenda card, so one assertion per view rather than one for the pair.
    expect(daySessions('agenda').map((session) => session.format)).toEqual([
      'Lightning talk',
      undefined,
    ])
    expect(daySessions('schedule_itinerary')[0]?.format).toBe('Lightning talk')
  })

  it('reaches the flat Session List too', () => {
    expect(flatSessions().map((session) => session.format)).toEqual(['Lightning talk', undefined])
  })

  it('INVENTS NOTHING for a submission that carries no Format', () => {
    // The whole negative rule. A default here would publish a claim about a session that the
    // organizer never made, on a page this app does not control.
    const sessions = flatSessions()

    expect(sessions[1]?.format).toBeUndefined()
    expect('format' in (sessions[1] ?? {})).toBe(false)
  })

  it('treats a blank Format as no Format rather than as an empty chip', () => {
    const sessions = project('session_list', [row({ id: 's3', title: 'Blank', format: '' })])?.body

    expect(sessions?.view === 'session_list' ? sessions.sessions[0]?.format : 'x').toBeUndefined()
  })

  it('spells a value exactly as the organizer Filters panel spells it', () => {
    // The facet the visitor ticks is built from the string the card printed, so the two must be
    // one function. `embedChoiceLabel` is that function; filter-options.ts calls it too.
    expect(embedChoiceLabel('lightning_talk')).toBe('Lightning talk')
    expect(embedChoiceLabel('workshop')).toBe('Workshop')
    expect(embedChoiceLabel('English')).toBe('English')
  })
})

describe('a session names its speakers with their job title and company', () => {
  it('carries the tagline and the company, not just a display name', () => {
    expect(flatSessions()[0]?.people).toEqual([
      {
        id: 'recAda',
        name: 'Ada Okafor',
        tagline: 'Principal Engineer',
        company: 'Latticework Systems',
      },
    ])
  })

  it('omits what a speaker record does not carry rather than printing a blank', () => {
    expect(flatSessions()[1]?.people).toEqual([{ id: 'recChen', name: 'Chen Wei' }])
  })

  it('leaves the bare `speakers` array alone, because search and the .ics read it', () => {
    expect(flatSessions()[0]?.speakers).toEqual(['Ada Okafor'])
  })

  it('names them on the day-grouped views as well, which is where one copy was missing', () => {
    expect(daySessions('agenda')[0]?.people[0]?.tagline).toBe('Principal Engineer')
    expect(daySessions('schedule_itinerary')[0]?.people[0]?.company).toBe('Latticework Systems')
  })
})

describe("a speaker's session sublist", () => {
  function speakers(view: 'speaker_list' | 'speaker_gallery' = 'speaker_gallery') {
    const body = project(view)?.body
    return body?.view === view ? body.speakers : []
  }

  it('gives each session a date and a room, not a title alone', () => {
    // Ada sorts first by surname (Okafor before Wei).
    expect(speakers()[0]?.sessions).toEqual([
      {
        id: 's1',
        title: 'Agent evaluation',
        when: 'Mon, October 12, 2026 at 12:00 PM - 12:30 PM',
        room: 'Main Stage',
      },
    ])
  })

  it('prints the SAME date string the session card printed', () => {
    // Not recomputed: a profile claiming a different time from the card beside it is the
    // cross-surface inconsistency EMB-16 samples for.
    const card = flatSessions().find((session) => session.id === 's1')

    expect(speakers()[0]?.sessions[0]?.when).toBe(card?.stamp)
  })

  it('reads identically in the list and in the gallery', () => {
    expect(speakers('speaker_list')[0]?.sessions).toEqual(speakers('speaker_gallery')[0]?.sessions)
  })

  it('omits the room for a session that has none', () => {
    const rows = [row({ id: 's4', title: 'Roomless', roomId: undefined })]
    const body = project('speaker_list', rows)?.body
    const sessions = body?.view === 'speaker_list' ? (body.speakers[0]?.sessions ?? []) : []

    expect(sessions[0]?.room).toBeUndefined()
    expect(sessions[0]?.when).toBe('Mon, October 12, 2026 at 12:00 PM - 12:30 PM')
  })

  it('falls back to the day label for a session with no start time', () => {
    // `Time to be announced` is the public agenda's own wording for the undated bucket, and a
    // sublist entry with no line at all would read as a rendering bug rather than as missing data.
    const rows = [row({ id: 's5', title: 'Undated', startsAt: undefined, endsAt: undefined })]
    const body = project('speaker_list', rows)?.body
    const sessions = body?.view === 'speaker_list' ? (body.speakers[0]?.sessions ?? []) : []

    expect(sessions[0]?.when).toBe('Time to be announced')
  })
})

describe('the gallery name search', () => {
  const ada = {
    id: 'recAda',
    name: 'Ada Okafor',
    initials: 'AO',
    tagline: 'Principal Engineer',
    company: 'Latticework Systems',
    sessions: [],
  }

  it('admits everybody when nothing has been typed', () => {
    expect(matchesSpeakerQuery(ada, '')).toBe(true)
    expect(matchesSpeakerQuery(ada, '  ')).toBe(true)
  })

  it('matches a surname, which is what a visitor scanning a grid types', () => {
    expect(matchesSpeakerQuery(ada, 'okafor')).toBe(true)
    expect(matchesSpeakerQuery(ada, 'Ada Okafor')).toBe(true)
  })

  it('matches the job title and the company', () => {
    expect(matchesSpeakerQuery(ada, 'latticework')).toBe(true)
    expect(matchesSpeakerQuery(ada, 'principal')).toBe(true)
  })

  it('ignores accents, in both directions', () => {
    const jose = { ...ada, id: 'recJose', name: 'José Álvarez' }

    expect(matchesSpeakerQuery(jose, 'jose')).toBe(true)
    expect(matchesSpeakerQuery(jose, 'álvarez')).toBe(true)
  })

  it('narrows to nobody when nobody matches', () => {
    expect(matchesSpeakerQuery(ada, 'keynote')).toBe(false)
  })

  it('survives a speaker carrying no title and no company', () => {
    const chen = { id: 'recChen', name: 'Chen Wei', initials: 'CW', sessions: [] }

    expect(matchesSpeakerQuery(chen, 'wei')).toBe(true)
    expect(matchesSpeakerQuery(chen, 'latticework')).toBe(false)
  })
})

// Style Options, Filters and Field Options, END TO END through the projection.
//
// The unit suites next to this one pin each set of rules on its own. This one exists for the defect
// class this surface keeps producing: a control that stores a value nothing reads. Every assertion
// here is of the form "set the control, then look at what the served embed would render", so a
// control wired to nothing fails here even when its own logic is correct.
//
// The load-bearing one is the last group. A filter must only ever NARROW what
// `publicAgendaRows` already allows: if the order were reversed, a stored filter value could put a
// pending or withdrawn session on the conference's website.

import { describe, expect, it } from 'vitest'

import { defaultEmbedFieldOptions, toggleEmbedField } from '@/features/cms/field-options'
import { EMPTY_EMBED_FILTERS, toggleEmbedFilter } from '@/features/cms/filters'
import {
  type EmbedProjectionEmbed,
  type EmbedSourceRow,
  embedProjection,
} from '@/features/cms/projection'
import { EMBED_DEFAULTS, type EmbedFilters, type EmbedView } from '@/types/cms'
import type { Room, Track } from '@/types/domain'

const ROOMS: readonly Room[] = [
  { id: 'recRoomMain', eventId: 'recEvent', name: 'Main Stage', order: 0 },
  { id: 'recRoomSide', eventId: 'recEvent', name: 'Side Room', order: 1 },
]
const TRACKS: readonly Track[] = [
  { id: 'recTrackAgents', eventId: 'recEvent', name: 'Agents', color: 'blue', order: 0 },
  { id: 'recTrackOps', eventId: 'recEvent', name: 'Ops', color: 'green', order: 1 },
]

const ADA = { id: 'recAda', firstName: 'Ada', lastName: 'Okafor', company: 'Bodo Labs' }

function row(patch: Partial<EmbedSourceRow> & { id: string; title: string }): EmbedSourceRow {
  return {
    status: 'accepted',
    scheduleStatus: 'published',
    calendarStatus: 'active',
    startsAt: '2026-10-12T16:00:00.000Z',
    endsAt: '2026-10-12T16:30:00.000Z',
    roomId: 'recRoomMain',
    trackId: 'recTrackAgents',
    tagIds: ['recTagAi'],
    format: 'talk',
    language: 'English',
    participants: [{ speaker: ADA }],
    ...patch,
  }
}

const ROWS: readonly EmbedSourceRow[] = [
  row({ id: 's1', title: 'Agent evaluation' }),
  row({
    id: 's2',
    title: 'Ops at scale',
    trackId: 'recTrackOps',
    roomId: 'recRoomSide',
    tagIds: ['recTagOps'],
    format: 'workshop',
    language: 'Spanish',
    startsAt: '2026-10-13T17:00:00.000Z',
    endsAt: '2026-10-13T17:45:00.000Z',
  }),
]

function embed(patch: Partial<EmbedProjectionEmbed> = {}): EmbedProjectionEmbed {
  return {
    enabled: true,
    view: 'agenda',
    ...EMBED_DEFAULTS,
    filters: EMPTY_EMBED_FILTERS,
    fieldOptions: defaultEmbedFieldOptions(),
    ...patch,
  }
}

function project(
  patch: Partial<EmbedProjectionEmbed> = {},
  rows: readonly EmbedSourceRow[] = ROWS,
) {
  return embedProjection({
    embed: embed(patch),
    event: { name: 'AI.Engineer Sandbox Event - NYC', timezone: 'America/New_York' },
    rows,
    rooms: ROOMS,
    tracks: TRACKS,
    deepLink: {},
  })
}

function titles(
  patch: Partial<EmbedProjectionEmbed>,
  view: EmbedView = 'agenda',
): readonly string[] {
  const body = project({ ...patch, view })?.body
  if (body?.view === 'agenda' || body?.view === 'schedule_itinerary') {
    return body.days.flatMap((day) => day.sessions.map((session) => session.title))
  }
  if (body?.view === 'session_list') return body.sessions.map((session) => session.title)
  return []
}

describe('Style Options reach the rendered embed', () => {
  it('carries the theme, so the frame can put `dark` on its wrapper', () => {
    expect(project()?.theme).toBe('light')
    expect(project({ colorTheme: 'dark' })?.theme).toBe('dark')
  })

  it('carries the primary colour as the tokens the header band resolves against', () => {
    expect(project({ primaryColor: '#0b1c33' })?.styleVars['--primary']).toBe('#0b1c33')
    expect(project({ primaryColor: '#0b1c33' })?.styleVars['--primary-foreground']).toBe('#ffffff')
  })

  it('falls back to the captured colour rather than emitting a broken one', () => {
    expect(project({ primaryColor: 'red' })?.styleVars['--primary']).toBe(
      EMBED_DEFAULTS.primaryColor,
    )
  })

  it('changes every day label and clock time when the date format changes', () => {
    const long = project({ dateTimeFormat: 'en_us_long' })
    const iso = project({ dateTimeFormat: 'iso' })

    const label = (result: ReturnType<typeof project>) =>
      result?.body.view === 'agenda' ? result.body.days[0]?.label : undefined
    const time = (result: ReturnType<typeof project>) =>
      result?.body.view === 'agenda' ? result.body.days[0]?.sessions[0]?.time : undefined

    expect(label(long)).toBe('Mon, October 12, 2026')
    expect(time(long)).toBe('12:00 PM - 12:30 PM')
    expect(label(iso)).toBe('2026-10-12')
    expect(time(iso)).toBe('12:00 - 12:30')
  })

  it('stamps the flat Session List with the word the captured label uses', () => {
    const body = project({ view: 'session_list' })?.body

    expect(body?.view === 'session_list' ? body.sessions[0]?.stamp : '').toBe(
      'Mon, October 12, 2026 at 12:00 PM - 12:30 PM',
    )
  })

  it('carries sanitized custom CSS, and carries nothing when there is none', () => {
    expect(project()?.extraCss).toBeUndefined()
    expect(project({ extraCss: '.a{color:red;}' })?.extraCss).toBe('.a{color:red;}')
  })
})

describe('Filters narrow the served feed', () => {
  const only = (dimension: Parameters<typeof toggleEmbedFilter>[1], value: string): EmbedFilters =>
    toggleEmbedFilter(EMPTY_EMBED_FILTERS, dimension, value, true)

  it('serves both sessions with no filter applied', () => {
    expect(titles({})).toEqual(['Agent evaluation', 'Ops at scale'])
  })

  it('narrows by track', () => {
    expect(titles({ filters: only('track', 'recTrackOps') })).toEqual(['Ops at scale'])
  })

  it('narrows by room, tag, format and language', () => {
    expect(titles({ filters: only('room', 'recRoomMain') })).toEqual(['Agent evaluation'])
    expect(titles({ filters: only('tag', 'recTagOps') })).toEqual(['Ops at scale'])
    expect(titles({ filters: only('format', 'workshop') })).toEqual(['Ops at scale'])
    expect(titles({ filters: only('language', 'English') })).toEqual(['Agent evaluation'])
  })

  it('narrows the flat Session List and both speaker views too', () => {
    const filters = only('track', 'recTrackOps')

    expect(titles({ filters }, 'session_list')).toEqual(['Ops at scale'])
    // The speaker roster is built from the filtered rows, so a speaker whose only session was
    // filtered out disappears rather than appearing with an empty session list.
    const body = project({ filters, view: 'speaker_list' })?.body
    const sessions = body?.view === 'speaker_list' ? (body.speakers[0]?.sessions ?? []) : []
    expect(sessions.map((session) => session.title)).toEqual(['Ops at scale'])
  })

  it('reports empty rather than falling back to the whole feed', () => {
    const projection = project({ filters: only('track', 'recTrackDeleted') })

    expect(projection?.empty).toBe(true)
  })
})

describe('Field Options change what is rendered', () => {
  it('reports the card the view draws and every field on it', () => {
    const projection = project()

    expect(projection?.card).toBe('agenda')
    expect([...(projection?.fields ?? [])].toSorted()).toEqual([
      'description',
      // Required, so it is in the set whatever the stored blob says. See field-options.ts on why
      // Format could not be a preselected optional field.
      'format',
      'room',
      'speakers',
      'time',
      'title',
      'track',
    ])
  })

  it('removes a deselected field from the view that draws it', () => {
    const fieldOptions = toggleEmbedField(defaultEmbedFieldOptions(), 'agenda', 'room', false)

    expect(project({ fieldOptions })?.fields.has('room')).toBe(false)
    expect(project({ fieldOptions })?.fields.has('track')).toBe(true)
  })

  it('keeps a required field whatever the stored blob says', () => {
    const fieldOptions = { agenda: [], speaker: [], session: [] }

    expect(project({ fieldOptions })?.fields.has('title')).toBe(true)
    expect(project({ fieldOptions })?.fields.has('time')).toBe(true)
  })

  it('switches card as the view switches', () => {
    expect(project({ view: 'speaker_gallery' })?.card).toBe('speaker')
    expect(project({ view: 'session_list' })?.card).toBe('session')
    expect(project({ view: 'schedule_itinerary' })?.card).toBe('agenda')
  })
})

describe('filters cannot widen what the visibility rule allows', () => {
  const HIDDEN: readonly EmbedSourceRow[] = [
    row({ id: 'p1', title: 'Still pending', status: 'pending' }),
    row({ id: 'p2', title: 'Withdrawn but published', status: 'withdrawn' }),
    row({ id: 'p3', title: 'Cancelled', calendarStatus: 'cancelled' }),
    row({ id: 'p4', title: 'Unpublished', scheduleStatus: 'scheduled' }),
  ]

  it('serves nothing when every row is non-public, filter or no filter', () => {
    expect(project({}, HIDDEN)?.empty).toBe(true)
    expect(project({ filters: EMPTY_EMBED_FILTERS }, HIDDEN)?.empty).toBe(true)
  })

  it('cannot be made to serve a non-public row by naming its track', () => {
    const filters = toggleEmbedFilter(EMPTY_EMBED_FILTERS, 'track', 'recTrackAgents', true)
    const body = project({ filters }, HIDDEN)?.body

    expect(body?.view === 'agenda' ? body.days : []).toEqual([])
  })
})

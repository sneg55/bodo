import { describe, expect, it } from 'vitest'

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

const ADA = {
  id: 'recAda',
  firstName: 'Ada',
  lastName: 'Okafor',
  company: 'Bodo Labs',
  tagline: 'Systems engineer',
}
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
  row({ id: 's1', title: 'Agent evaluation' }),
  row({
    id: 's2',
    title: 'Retrieval systems',
    startsAt: '2026-10-13T17:00:00.000Z',
    endsAt: '2026-10-13T17:45:00.000Z',
    participants: [{ speaker: CHEN }],
  }),
]

function project(patch: {
  view?: EmbedView
  enabled?: boolean
  rows?: readonly EmbedSourceRow[]
  deepLink?: { speakerId?: string; view?: EmbedView }
}) {
  return embedProjection({
    embed: {
      enabled: patch.enabled ?? true,
      view: patch.view ?? 'agenda',
      // Style Options, Filters and Field Options at their defaults: this file covers the
      // visibility rule and the five layouts, and tests/embed-projection-options.test.ts covers
      // what happens when those three are set to anything else.
      ...EMBED_DEFAULTS,
      filters: EMPTY_EMBED_FILTERS,
      fieldOptions: defaultEmbedFieldOptions(),
    },
    event: { name: 'AI.Engineer Sandbox Event - NYC', timezone: 'America/New_York' },
    rows: patch.rows ?? ROWS,
    rooms: ROOMS,
    tracks: TRACKS,
    deepLink: patch.deepLink ?? {},
  })
}

describe('a disabled embed serves nothing', () => {
  it('projects undefined, which is what the route turns into a 404', () => {
    expect(project({ enabled: false })).toBeUndefined()
  })

  it('projects undefined even when there is plenty to render', () => {
    // The switch is not "hide the content": it is "this URL does not resolve". An empty
    // projection would still render a header band and tell a visitor the feed is alive.
    expect(project({ enabled: false, view: 'speaker_gallery' })).toBeUndefined()
  })
})

describe('a session the public must not see never reaches an embed', () => {
  const hidden: readonly (readonly [string, Partial<EmbedSourceRow>])[] = [
    ['withdrawn but still marked published', { status: 'withdrawn' }],
    ['cancelled on the calendar', { calendarStatus: 'cancelled' }],
    ['scheduled but not published', { scheduleStatus: 'scheduled' }],
    ['still pending review', { status: 'pending' }],
    ['declined', { status: 'declined' }],
  ]

  for (const [label, patch] of hidden) {
    it(`drops a session that is ${label}`, () => {
      const rows = [row({ id: 's1', title: 'Agent evaluation', ...patch })]
      const projection = project({ rows })

      expect(projection?.empty).toBe(true)
      expect(projection?.body).toEqual({ view: 'agenda', days: [] })
    })
  }

  it('drops the speaker with it, so a declined submitter is not published in a gallery', () => {
    const rows = [row({ id: 's1', title: 'Agent evaluation', status: 'declined' })]
    const projection = project({ rows, view: 'speaker_gallery' })

    expect(projection?.body).toEqual({ view: 'speaker_gallery', speakers: [] })
  })
})

describe('the five views', () => {
  it('groups the Agenda view by day, in the event timezone and not in UTC', () => {
    const projection = project({ view: 'agenda' })
    const body = projection?.body

    expect(body?.view).toBe('agenda')
    // 16:00Z on Oct 12 is noon in New York, so it belongs to Oct 12 and not to Oct 13.
    //
    // The label shape follows `Date/Time Format`, which defaults to the option the expanded panel
    // captures: `English (US): Fri, June 3, 2022 at 11:00 PM`. Short weekday, long month, day,
    // year. It no longer matches `/agenda/<slug>`'s own `Monday, October 12`, and that is the
    // point of the control. tests/embed-date-format.test.ts pins both formats.
    expect(body?.view === 'agenda' ? body.days.map((day) => day.label) : []).toEqual([
      'Mon, October 12, 2026',
      'Tue, October 13, 2026',
    ])
    expect(body?.view === 'agenda' ? body.days[0]?.sessions[0]?.time : '').toBe(
      '12:00 PM - 12:30 PM',
    )
  })

  it('gives the Schedule Itinerary the same day groups under its own view tag', () => {
    const projection = project({ view: 'schedule_itinerary' })
    expect(projection?.body.view).toBe('schedule_itinerary')
    expect(projection?.viewLabel).toBe('Schedule Itinerary')
  })

  it('flattens the Session List and keeps the day on each row', () => {
    const projection = project({ view: 'session_list' })
    const body = projection?.body

    expect(body?.view === 'session_list' ? body.sessions.map((s) => s.title) : []).toEqual([
      'Agent evaluation',
      'Retrieval systems',
    ])
    expect(body?.view === 'session_list' ? body.sessions[1]?.dayLabel : '').toBe(
      'Tue, October 13, 2026',
    )
  })

  it('builds both speaker views off the public rows, sorted and with their sessions', () => {
    for (const view of ['speaker_list', 'speaker_gallery'] as const) {
      const projection = project({ view })
      const body = projection?.body
      const speakers = body?.view === view ? body.speakers : []

      expect(speakers.map((speaker) => speaker.name)).toEqual(['Ada Okafor', 'Chen Wei'])
      // The sublist carries the DATE and the ROOM, not just the title. A profile listing bare
      // titles tells a visitor which talks a person is giving and nothing about when to be
      // where, which is the one thing they opened it to find out.
      expect(speakers[0]?.sessions).toEqual([
        {
          id: 's1',
          title: 'Agent evaluation',
          when: 'Mon, October 12, 2026 at 12:00 PM - 12:30 PM',
          room: 'Main Stage',
        },
      ])
      expect(speakers[0]?.initials).toBe('AO')
      expect(speakers[0]?.company).toBe('Bodo Labs')
    }
  })

  it('orders the roster by SURNAME, not by the display name', () => {
    // The case the old sort got wrong, and the reason it went unnoticed: sorting on
    // "First Last" is alphabetical by GIVEN name, which agrees with surname order often
    // enough to look right. Zoe Adams belongs above Ada Okafor in a programme's speaker
    // list, and below her if you sort the display name.
    const rows = [
      row({ id: 's1', title: 'Agent evaluation' }),
      row({
        id: 's9',
        title: 'Closing remarks',
        participants: [{ speaker: { id: 'recZoe', firstName: 'Zoe', lastName: 'Adams' } }],
      }),
    ]
    const body = project({ rows, view: 'speaker_list' })?.body
    const speakers = body?.view === 'speaker_list' ? body.speakers : []

    expect(speakers.map((speaker) => speaker.name)).toEqual(['Zoe Adams', 'Ada Okafor'])
  })

  it('breaks a shared surname on the given name', () => {
    const rows = [
      row({
        id: 's1',
        title: 'Later',
        participants: [{ speaker: { id: 'recZ', firstName: 'Zoe', lastName: 'Okafor' } }],
      }),
      row({ id: 's2', title: 'Earlier' }),
    ]
    const body = project({ rows, view: 'speaker_list' })?.body
    const speakers = body?.view === 'speaker_list' ? body.speakers : []

    expect(speakers.map((speaker) => speaker.name)).toEqual(['Ada Okafor', 'Zoe Okafor'])
  })

  it('collapses a speaker appearing twice into one entry with both sessions', () => {
    const rows = [
      row({ id: 's1', title: 'Agent evaluation' }),
      row({ id: 's3', title: 'Closing keynote', startsAt: '2026-10-12T20:00:00.000Z' }),
    ]
    const projection = project({ rows, view: 'speaker_list' })
    const body = projection?.body

    expect(body?.view === 'speaker_list' ? body.speakers : []).toHaveLength(1)
    const sessions = body?.view === 'speaker_list' ? (body.speakers[0]?.sessions ?? []) : []
    expect(sessions.map((session) => session.title)).toEqual([
      'Agent evaluation',
      'Closing keynote',
    ])
  })
})

describe('query-parameter deep linking', () => {
  it('narrows every view to the named speaker and reports whose feed it is', () => {
    const projection = project({ view: 'agenda', deepLink: { speakerId: 'recChen' } })
    const body = projection?.body

    expect(projection?.focus).toBe('Chen Wei')
    expect(
      body?.view === 'agenda' ? body.days.flatMap((day) => day.sessions.map((s) => s.title)) : [],
    ).toEqual(['Retrieval systems'])
  })

  it('narrows the speaker roster too', () => {
    const projection = project({ view: 'speaker_gallery', deepLink: { speakerId: 'recAda' } })
    const body = projection?.body

    expect(body?.view === 'speaker_gallery' ? body.speakers.map((s) => s.id) : []).toEqual([
      'recAda',
    ])
  })

  it('serves an EMPTY feed for a speaker id that matches nobody, never the whole schedule', () => {
    const projection = project({ deepLink: { speakerId: 'recNobody' } })

    expect(projection?.empty).toBe(true)
    expect(projection?.focus).toBeUndefined()
  })

  it('lets the URL choose the layout, over rows the visibility rule already chose', () => {
    const projection = project({ view: 'agenda', deepLink: { view: 'speaker_list' } })

    expect(projection?.body.view).toBe('speaker_list')
    expect(projection?.viewLabel).toBe('Speaker List')
  })
})

describe('the header band', () => {
  it('carries the event name, which is what ref 33 blue band shows', () => {
    expect(project({})?.eventName).toBe('AI.Engineer Sandbox Event - NYC')
  })
})

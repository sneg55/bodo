// The four non-styled representations of an embed: `.html`, `.json`, `.xml` and `.ics`.
//
// The property under test in every case is the SAME one, and it is the reason these formats are
// worth having tests at all: a feed must publish exactly what the rendered embed publishes. An
// organizer who filtered their embed to one track has filtered their JSON to one track, and one
// who switched a field off has switched it off everywhere. A format that quietly widened either
// would be a data leak wearing a content type, and nothing in the UI would show it.
//
// So each case drives the real projection (the same function the page renders from), serializes
// it, and asserts on the bytes. The escaping cases are the other half: this output lands in
// somebody else's page, in an XML parser, and in a calendar client, and each of those breaks on
// a different character.

import { describe, expect, it } from 'vitest'
import { embedFeedHtml } from '@/features/cms/feed-html'
import { embedFeed, embedFeedJson } from '@/features/cms/feed-model'
import { embedFeedXml } from '@/features/cms/feed-xml'
import { defaultEmbedFieldOptions, toggleEmbedField } from '@/features/cms/field-options'
import { EMPTY_EMBED_FILTERS, toggleEmbedFilter } from '@/features/cms/filters'
import { type EmbedSourceRow, embedProjection } from '@/features/cms/projection'
import {
  EMBED_DEFAULTS,
  type EmbedFieldOptions,
  type EmbedFilters,
  type EmbedView,
} from '@/types/cms'
import type { Room, Track } from '@/types/domain'

const GENERATED = '2026-08-10T09:00:00.000Z'

const ROOMS: readonly Room[] = [
  { id: 'recRoom1', eventId: 'recEvent', name: 'Main Stage', order: 0 },
  { id: 'recRoom2', eventId: 'recEvent', name: 'Workshop Room', order: 1 },
]
const TRACKS: readonly Track[] = [
  { id: 'recTrackAgents', eventId: 'recEvent', name: 'Agents', color: 'blue', order: 0 },
  { id: 'recTrackOps', eventId: 'recEvent', name: 'Ops', color: 'green', order: 1 },
]

const ADA = {
  id: 'recAda',
  firstName: 'Ada',
  lastName: 'Okafor',
  company: 'Bodo Labs',
  tagline: 'Systems engineer',
  bio: 'Ada builds evaluation harnesses.',
}
const CHEN = { id: 'recChen', firstName: 'Chen', lastName: 'Wei' }

/**
 * `EmbedSourceRow` plus the abstract.
 *
 * `description` is not on `EmbedSourceRow`, but it IS what `readServedEmbed` puts on every row it
 * hands the projection (`describeSessions` lifts it out of `answersJson`) and what
 * `groupPublicSchedule` reads structurally. So it reaches the output, and a fixture that omitted
 * it would leave the Description field untested in all four formats.
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
  row({ id: 's1', title: 'Agent evaluation', description: 'How we score agents.' }),
  row({
    id: 's2',
    title: 'Retrieval systems',
    startsAt: '2026-10-13T17:00:00.000Z',
    endsAt: '2026-10-13T17:45:00.000Z',
    roomId: 'recRoom2',
    trackId: 'recTrackOps',
    participants: [{ speaker: CHEN }],
  }),
]

function feedFor(patch: {
  view?: EmbedView
  rows?: readonly SourceRow[]
  filters?: EmbedFilters
  fieldOptions?: EmbedFieldOptions
}) {
  const projection = embedProjection({
    embed: {
      enabled: true,
      view: patch.view ?? 'agenda',
      ...EMBED_DEFAULTS,
      filters: patch.filters ?? EMPTY_EMBED_FILTERS,
      fieldOptions: patch.fieldOptions ?? defaultEmbedFieldOptions(),
    },
    event: { name: 'AI.Engineer Sandbox Event - NYC', timezone: 'America/New_York' },
    rows: patch.rows ?? ROWS,
    rooms: ROOMS,
    tracks: TRACKS,
    deepLink: {},
  })
  if (projection === undefined) throw new Error('expected a projection')
  return embedFeed(projection, GENERATED)
}

describe('the feed carries what the rendered embed carries', () => {
  it('lists every public session, with the event and the view around it', () => {
    const feed = feedFor({})

    expect(feed.event).toBe('AI.Engineer Sandbox Event - NYC')
    expect(feed.view).toBe('agenda')
    expect(feed.sessions.map((session) => session.title)).toEqual([
      'Agent evaluation',
      'Retrieval systems',
    ])
    // No speakers half on a session view: a feed publishes the widget the organizer configured.
    expect(feed.speakers).toEqual([])
  })

  it('resolves rooms, tracks and speaker names rather than emitting record ids', () => {
    const [first] = feedFor({}).sessions

    expect(first).toMatchObject({
      title: 'Agent evaluation',
      room: 'Main Stage',
      track: 'Agents',
      speakers: ['Ada Okafor'],
      startsAt: '2026-10-12T16:00:00.000Z',
    })
    expect(JSON.stringify(first)).not.toContain('rec')
  })

  it('carries the day heading, formatted in the event timezone and not in UTC', () => {
    // 16:00Z on 12 October is noon in New York, so both sessions belong to the day they were
    // scheduled on rather than to whatever day it is in UTC.
    expect(feedFor({}).sessions.map((session) => session.day)).toEqual([
      'Mon, October 12, 2026',
      'Tue, October 13, 2026',
    ])
  })

  it('yields speakers and no sessions for a roster view', () => {
    const feed = feedFor({ view: 'speaker_list' })

    expect(feed.sessions).toEqual([])
    expect(feed.speakers.map((speaker) => speaker.name)).toEqual(['Ada Okafor', 'Chen Wei'])
    expect(feed.speakers[0]).toMatchObject({ company: 'Bodo Labs', tagline: 'Systems engineer' })
  })
})

describe('a filtered embed cannot be widened by asking for another format', () => {
  const filters = toggleEmbedFilter(EMPTY_EMBED_FILTERS, 'track', 'recTrackAgents', true)

  it('drops the other track from the JSON exactly as it drops it from the page', () => {
    const feed = feedFor({ filters })

    expect(feed.sessions.map((session) => session.title)).toEqual(['Agent evaluation'])
    expect(embedFeedJson(feed)).not.toContain('Retrieval systems')
  })

  it('drops it from the XML and the HTML too', () => {
    const feed = feedFor({ filters })

    expect(embedFeedXml(feed)).not.toContain('Retrieval systems')
    expect(embedFeedHtml(feed)).not.toContain('Retrieval systems')
  })

  it('drops a speaker whose only session the filter removed', () => {
    const feed = feedFor({ view: 'speaker_list', filters })

    expect(feed.speakers.map((speaker) => speaker.name)).toEqual(['Ada Okafor'])
  })
})

describe('Field Options apply to every format', () => {
  const withoutRoom = toggleEmbedField(defaultEmbedFieldOptions(), 'agenda', 'room', false)

  it('omits a deselected field from the model, so no serializer can print it', () => {
    const feed = feedFor({ fieldOptions: withoutRoom })

    expect(feed.sessions.every((session) => session.room === undefined)).toBe(true)
    expect(embedFeedJson(feed)).not.toContain('Main Stage')
    expect(embedFeedXml(feed)).not.toContain('Main Stage')
    expect(embedFeedHtml(feed)).not.toContain('Main Stage')
  })

  it('keeps a required field whatever the stored blob says', () => {
    // `title` and `time` are the Agenda card's grey tier, so they survive a blob that names
    // neither. The guarantee is `visibleEmbedFields`, not a disabled checkbox.
    const feed = feedFor({ fieldOptions: { agenda: [], speaker: [], session: [] } })

    expect(feed.sessions[0]?.title).toBe('Agent evaluation')
    expect(feed.sessions[0]?.time).toBeDefined()
    expect(feed.sessions[0]?.speakers).toBeUndefined()
  })
})

describe('the JSON representation', () => {
  it('parses, and round-trips the sessions it printed', () => {
    const feed = feedFor({})
    const parsed = JSON.parse(embedFeedJson(feed)) as { sessions: { title: string }[] }

    expect(parsed.sessions.map((session) => session.title)).toEqual([
      'Agent evaluation',
      'Retrieval systems',
    ])
  })

  it('omits absent values rather than printing nulls', () => {
    const feed = feedFor({ rows: [row({ id: 's3', title: 'Untracked', trackId: undefined })] })

    expect(embedFeedJson(feed)).not.toContain('null')
    expect(feed.sessions[0]).not.toHaveProperty('track')
  })
})
